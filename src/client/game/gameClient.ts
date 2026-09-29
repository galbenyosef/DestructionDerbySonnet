import * as THREE from 'three';
import { CAR_FORWARD, NET, PHYSICS } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatRotate, vdot, vlen } from '../../shared/math';
import type { PlayerInfo, ServerMessage } from '../../shared/protocol';
import { steeringAngle } from '../../shared/vehicle';
import { Connection } from '../net/connection';
import { LagSocket, type LagOptions } from '../net/latency';
import { formatNetStats } from '../net/netStats';
import { ClientSession, type DrawPose, type NetMode } from '../net/session';
import type { Hud } from '../ui/hud';
import type { JoinChoice } from '../ui/menu';
import { applyChaseView, ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { MatchState } from './matchState';
import { NameTag } from './nameTag';
import type { GameScene } from './scene';
import { SpectatorCamera } from './spectator';
import { FixedStepper } from './stepper';

export interface GameClientOptions {
  gs: GameScene;
  hud: Hud;
  choice: JoinChoice;
  url: string;
  /** Called once when the game ends (server refused, connection lost, ...). */
  onExit(message?: string): void;
  /** 'predict' (default) runs the local simulation with rollback; 'interp' only interpolates server snapshots (?net=interp). */
  net?: NetMode;
  /** Simulated network conditions (?lag=&jitter=&loss=). */
  lag?: LagOptions | null;
}

/** Keys that switch the car the spectator camera follows (they steer when you drive, so they are free once you are out). */
const CYCLE_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowLeft: -1,
  KeyA: -1,
  KeyQ: -1,
  ArrowRight: 1,
  KeyD: 1,
  KeyE: 1,
};

/**
 * Sends inputs at 60 Hz. In 'predict' mode (default) it runs the shared simulation locally for every car, rolls back
 * to each server snapshot and replays the unacknowledged inputs, so your own car reacts instantly; in 'interp' mode
 * (?net=interp) it only draws interpolated server snapshots.
 */
export class GameClient {
  private readonly views = new Map<number, CarView>();
  private readonly tags = new Map<number, NameTag>();
  private readonly session: ClientSession;
  private readonly chase = new ChaseCamera();
  private readonly spectator = new SpectatorCamera();
  private readonly match = new MatchState();
  private readonly keyboard = new KeyboardInput(undefined, undefined, (code) => this.onKey(code));
  private readonly stepper = new FixedStepper(PHYSICS.DT);
  private readonly timer = new THREE.Timer();
  private readonly conn: Connection;
  private mySlot = -1;
  private roomCode = '';
  private joined = false;
  private opened = false;
  private roster: PlayerInfo[] = [];
  private epoch = 0;
  private lastPoses: DrawPose[] = [];
  /** True while your own car is running: the chase camera follows it; otherwise the spectator camera orbits another car. */
  private driving = false;
  private statsVisible = false;
  private raf = 0;
  private stopped = false;
  private frames = 0;
  private fps = 0;
  private fpsAt = performance.now();
  private statsAt = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.session = new ClientSession(opts.net ?? 'predict', {
      onFallback: (reason) => {
        console.error('Prediction unavailable, falling back to interpolation:', reason);
        this.opts.hud.showNotice('Prediction unavailable — using interpolation.');
      },
      onStall: () => this.opts.hud.showNotice('Connection unstable — the server is not receiving your controls.'),
    });
    this.timer.connect(document);
    const lag = opts.lag ?? null;
    this.conn = new Connection(
      opts.url,
      {
        onOpen: () => this.onOpen(),
        onMessage: (m) => this.onMessage(m),
        onSnapshot: (s, at) => this.session.onSnapshot(s, at),
        onClose: (info) => this.onClose(info),
      },
      undefined,
      lag ? (u) => new LagSocket(new WebSocket(u), lag) as unknown as WebSocket : undefined,
    );
  }

  start(): void {
    this.conn.connect();
    this.raf = requestAnimationFrame(this.frame);
    const derby = ((window as unknown as { __derby?: Record<string, unknown> }).__derby ??= {});
    Object.defineProperty(derby, 'debug', { value: () => this.debug(), configurable: true, writable: true });
    Object.defineProperty(derby, 'netStats', { get: () => this.session.predicted?.stats.summary(performance.now()) ?? null, configurable: true });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.keyboard.dispose();
    this.conn.close();
    for (const slot of [...this.tags.keys()]) this.removeTag(slot);
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.timer.dispose();
    this.session.dispose();
    this.opts.hud.dispose();
  }

  private finish(message?: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onExit(message);
  }

  private onOpen(): void {
    this.opened = true;
    const { choice } = this.opts;
    this.conn.send({
      t: 'hello',
      v: NET.PROTOCOL_VERSION,
      name: choice.name,
      color: choice.color,
      mode: choice.mode,
      code: choice.code,
    });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.you;
        this.roomCode = m.room.code;
        this.joined = true;
        this.epoch = m.epoch;
        this.roster = m.players;
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null);
        this.match.onWelcome(m);
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        break;
      case 'roster':
        this.epoch = m.epoch;
        this.roster = m.players;
        this.mySlot = m.you; // slots are per round
        this.session.onRoster(m.epoch, m.you); // a new world: drop everything buffered or predicted
        this.chase.reset(); // and start the camera at the new spawn
        this.spectator.reset();
        this.match.onRoster(m);
        this.applyRoster();
        break;
      case 'phase':
        this.session.onPhase(m.phase);
        this.match.onPhase(m);
        break;
      case 'hit':
        this.match.onHit(m);
        break;
      case 'ko':
        this.match.onKo(m);
        break;
      case 'scores':
        this.match.onScores(m);
        break;
      case 'results':
        this.match.onResults(m);
        break;
      case 'error':
        if (this.joined) this.opts.hud.showNotice(m.message);
        else this.finish(m.message);
        break;
      case 'pong':
        break;
    }
  }

  private onClose(info: { code: number; reason: string }): void {
    if (this.stopped) return;
    let message: string;
    if (!this.opened) message = 'Could not reach the game server.';
    else if (info.code === 4001) message = 'You were disconnected for inactivity.';
    else if (info.code === 1002) message = 'The game was updated — reload the page and try again.';
    else message = `Disconnected from the server${info.reason ? `: ${info.reason}` : ''}.`;
    this.finish(message);
  }

  private applyRoster(): void {
    const slots = new Set(this.roster.map((p) => p.slot));
    for (const p of this.roster) {
      const existing = this.views.get(p.slot);
      if (existing) {
        existing.setColor(p.color);
      } else {
        const view = new CarView(p.color);
        view.group.visible = false; // shown once the first snapshot for this world arrives
        this.opts.gs.scene.add(view.group);
        this.views.set(p.slot, view);
      }
      if (p.slot === this.mySlot) this.removeTag(p.slot); // no floating name over your own car
      else this.setTag(p.slot, p.name);
    }
    for (const [slot, view] of this.views) {
      if (!slots.has(slot)) {
        this.removeTag(slot);
        view.dispose();
        this.views.delete(slot);
      }
    }
  }

  private setTag(slot: number, name: string): void {
    const view = this.views.get(slot);
    if (!view) return;
    const existing = this.tags.get(slot);
    if (existing && existing.name === name) return;
    existing?.dispose();
    const tag = new NameTag(name);
    view.group.add(tag.group);
    this.tags.set(slot, tag);
  }

  private removeTag(slot: number): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    tag.dispose();
    this.tags.delete(slot);
  }

  /** F3 shows the network line; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
    if (code === 'F3') {
      this.statsVisible = !this.statsVisible;
      this.opts.hud.setStatsVisible(this.statsVisible);
      return;
    }
    const direction = CYCLE_KEYS[code];
    if (direction && !this.driving) this.spectator.cycle(this.lastPoses, direction);
  }

  private readonly frame = (ts: number): void => {
    if (this.stopped) return;
    this.timer.update(ts);
    const dt = this.timer.getDelta();

    let alpha = 1;
    if (this.joined) {
      alpha = this.stepper.advance(dt, () => {
        const input = quantizeInput(this.keyboard.sample(PHYSICS.DT));
        this.conn.sendInput(this.session.nextInput(input), input);
      });
    }

    const poses = this.session.poses(alpha, dt, performance.now());
    this.lastPoses = poses;
    const seen = new Set<number>();
    for (const p of poses) {
      const view = this.views.get(p.slot);
      if (!view || !p.visible) continue;
      seen.add(p.slot);
      view.group.visible = true;
      view.setPose(p.pos, p.quat);
      view.setWreck(!p.alive);
      this.tags.get(p.slot)?.update(p.hp, p.alive);
      const vf = vdot(p.linvel, quatRotate(p.quat, CAR_FORWARD));
      view.animateWheels(vf, steeringAngle(p.steer, vf), dt);
    }
    for (const [slot, view] of this.views) if (!seen.has(slot)) view.group.visible = false;

    // chase your own car while it runs; once it is a wreck (or you have none this round) orbit a car that still runs
    const mine = poses.find((p) => p.slot === this.mySlot && p.visible);
    this.driving = mine?.alive === true;
    const orbit = this.driving ? null : this.spectator.view(poses, dt);
    if (orbit) applyChaseView(this.opts.gs.camera, orbit);
    else if (mine) this.chase.update(this.opts.gs.camera, { pos: mine.pos, quat: mine.quat, speed: vlen(mine.linvel) }, dt);
    this.match.setWatching(this.driving ? -1 : this.spectator.watching);
    this.match.onCars(poses.filter((p) => p.visible).map((p) => ({ slot: p.slot, hp: p.hp, alive: p.alive, speed: vlen(p.linvel) })));
    this.opts.hud.setMatch(this.match.view(), this.keyboard.isDown('Tab'));
    this.opts.gs.resize();
    this.opts.gs.render();
    this.updateStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private updateStats(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.statsAt > 250) {
      this.statsAt = now;
      const predicted = this.session.predicted;
      const net = predicted
        ? formatNetStats(predicted.stats.summary(now)) + (this.session.stalled ? ' · connection unstable' : '')
        : `snapshots ${this.session.snapshotsReceived} · buffer ${this.session.interpolator.size}`;
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${net}`);
    }
  }

  /** Read-only snapshot of client state for automated checks: `window.__derby.debug()`. */
  private debug() {
    const predicted = this.session.predicted;
    return {
      mode: this.session.mode,
      phase: this.session.phase,
      mySlot: this.mySlot,
      roomCode: this.roomCode,
      epoch: this.epoch,
      joined: this.joined,
      roster: this.roster,
      rttMs: Math.round(this.conn.rttMs),
      seq: this.session.inputSequence,
      prediction: predicted
        ? {
            ...predicted.predictor.counters,
            synced: predicted.predictor.isSynced,
            stalled: predicted.predictor.isStalled,
            epoch: predicted.predictor.worldEpoch,
            lastIgnored: predicted.predictor.lastIgnored,
          }
        : null,
      snapshotsReceived: this.session.snapshotsReceived,
      interpSize: this.session.interpolator.size,
      stale: this.session.interpolator.stale,
      fps: this.fps,
      poses: this.lastPoses.map((p) => ({
        slot: p.slot,
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        speed: vlen(p.linvel),
        extrapolated: p.extrapolated,
        visible: p.visible,
        alive: p.alive,
        hp: p.hp,
      })),
    };
  }
}

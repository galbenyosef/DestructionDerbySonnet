import * as THREE from 'three';
import { CAR_FORWARD, NET, PHYSICS } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatRotate, vdot, vlen } from '../../shared/math';
import type { PlayerInfo, ServerMessage, Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { steeringAngle } from '../../shared/vehicle';
import { Connection } from '../net/connection';
import { SnapshotInterpolator } from '../net/interp';
import { LagSocket, type LagOptions } from '../net/latency';
import { formatNetStats } from '../net/netStats';
import { PredictedWorld } from '../net/predictedWorld';
import type { Hud } from '../ui/hud';
import type { JoinChoice } from '../ui/menu';
import { ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { createNameTag, disposeNameTag } from './nameTag';
import type { GameScene } from './scene';
import { FixedStepper } from './stepper';

export interface GameClientOptions {
  gs: GameScene;
  hud: Hud;
  choice: JoinChoice;
  url: string;
  /** Called once when the game ends (server refused, connection lost, ...). */
  onExit(message?: string): void;
  /** 'predict' (default) runs the local simulation with rollback; 'interp' only interpolates server snapshots (?net=interp). */
  net?: 'predict' | 'interp';
  /** Simulated network conditions (?lag=&jitter=&loss=). */
  lag?: LagOptions | null;
}

/** One car as drawn this frame, whichever networking mode produced it. */
interface DrawPose {
  slot: number;
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  steer: number;
  visible: boolean;
  extrapolated: boolean;
}

/**
 * Sends inputs at 60 Hz. In 'predict' mode (default) it runs the shared simulation locally for every car, rolls back
 * to each server snapshot and replays the unacknowledged inputs, so your own car reacts instantly; in 'interp' mode
 * (?net=interp) it only draws interpolated server snapshots.
 */
export class GameClient {
  private readonly views = new Map<number, CarView>();
  private readonly tags = new Map<number, THREE.Sprite>();
  private readonly interp = new SnapshotInterpolator();
  private mode: 'predict' | 'interp';
  private world: PredictedWorld | null = null;
  private readonly chase = new ChaseCamera();
  private readonly keyboard = new KeyboardInput();
  private readonly stepper = new FixedStepper(PHYSICS.DT);
  private readonly timer = new THREE.Timer();
  private readonly conn: Connection;
  private mySlot = -1;
  private roomCode = '';
  private joined = false;
  private opened = false;
  private roster: PlayerInfo[] = [];
  private epoch = 0;
  private seq = 0;
  private snapshotsReceived = 0;
  private lastPoses: DrawPose[] = [];
  private raf = 0;
  private stopped = false;
  private frames = 0;
  private fps = 0;
  private fpsAt = performance.now();
  private statsAt = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.mode = opts.net ?? 'predict';
    this.timer.connect(document);
    const lag = opts.lag ?? null;
    this.conn = new Connection(
      opts.url,
      {
        onOpen: () => this.onOpen(),
        onMessage: (m) => this.onMessage(m),
        onSnapshot: (s, at) => {
          if (this.world) {
            const outcome = this.world.onSnapshot(s, at).outcome;
            if (this.world.failure !== null) this.fallBackToInterpolation(this.world.failure, s, at);
            else if (outcome === 'applied' || outcome === 'synced') this.snapshotsReceived++;
          } else if (this.interp.push(s, at)) this.snapshotsReceived++;
        },
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
    Object.defineProperty(derby, 'netStats', { get: () => this.world?.stats.summary(performance.now()) ?? null, configurable: true });
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
    this.world?.dispose();
    this.world = null;
    this.opts.hud.dispose();
  }

  private finish(message?: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onExit(message);
  }

  /** The local simulation cannot run (for example the physics engine failed to load): draw interpolated snapshots instead. */
  private fallBackToInterpolation(reason: string, snapshot: Snapshot, arrivalMs: number): void {
    console.error('Prediction unavailable, falling back to interpolation:', reason);
    this.world?.dispose();
    this.world = null;
    this.mode = 'interp';
    this.interp.reset(this.epoch);
    if (this.interp.push(snapshot, arrivalMs)) this.snapshotsReceived++;
    this.opts.hud.showNotice('Prediction unavailable — using interpolation.');
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
        this.interp.reset(m.epoch);
        if (this.mode === 'predict') {
          this.world?.dispose();
          this.world = new PredictedWorld(m.you);
          this.world.beginWorld(m.epoch);
        }
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'roster':
        this.epoch = m.epoch;
        this.roster = m.players;
        this.interp.reset(m.epoch); // a new world: drop all buffered snapshots
        this.world?.beginWorld(m.epoch);
        this.applyRoster();
        this.opts.hud.setPlayers(this.roster, this.mySlot);
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
    if (existing && existing.userData.name === name) return;
    if (existing) disposeNameTag(existing);
    const tag = createNameTag(name);
    tag.userData.name = name;
    view.group.add(tag);
    this.tags.set(slot, tag);
  }

  private removeTag(slot: number): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    disposeNameTag(tag);
    this.tags.delete(slot);
  }

  private readonly frame = (ts: number): void => {
    if (this.stopped) return;
    this.timer.update(ts);
    const dt = this.timer.getDelta();

    let alpha = 1;
    if (this.joined) {
      alpha = this.stepper.advance(dt, () => {
        const input = quantizeInput(this.keyboard.sample(PHYSICS.DT));
        const seq = this.world ? this.world.step(input) : (this.seq = (this.seq + 1) >>> 0);
        this.conn.sendInput(seq, input);
      });
    }

    const poses = this.drawPoses(alpha, dt);
    this.lastPoses = poses;
    const seen = new Set<number>();
    for (const p of poses) {
      const view = this.views.get(p.slot);
      if (!view || !p.visible) continue;
      seen.add(p.slot);
      view.group.visible = true;
      view.setPose(p.pos, p.quat);
      const vf = vdot(p.linvel, quatRotate(p.quat, CAR_FORWARD));
      view.animateWheels(vf, steeringAngle(p.steer, vf), dt);
    }
    for (const [slot, view] of this.views) if (!seen.has(slot)) view.group.visible = false;

    const me = poses.find((p) => p.slot === this.mySlot && p.visible);
    if (me) {
      this.chase.update(this.opts.gs.camera, { pos: me.pos, quat: me.quat, speed: vlen(me.linvel) }, dt);
    }
    this.opts.gs.resize();
    this.opts.gs.render();
    this.updateStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawPoses(alpha: number, dt: number): DrawPose[] {
    if (this.world) {
      return this.world.frame(alpha, dt).map((p) => ({
        slot: p.slot,
        pos: p.pos,
        quat: p.quat,
        linvel: p.linvel,
        steer: p.steer,
        visible: p.visible,
        extrapolated: false,
      }));
    }
    return this.interp.sample(performance.now()).map((p) => ({
      slot: p.slot,
      pos: p.state.pos,
      quat: p.state.quat,
      linvel: p.state.linvel,
      steer: p.steer,
      visible: true,
      extrapolated: p.extrapolated,
    }));
  }

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
      const net = this.world
        ? formatNetStats(this.world.stats.summary(now))
        : `snapshots ${this.snapshotsReceived} · buffer ${this.interp.size}`;
      this.opts.hud.setStats(`${this.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${net}`);
    }
  }

  /** Read-only snapshot of client state for automated checks: `window.__derby.debug()`. */
  private debug() {
    return {
      mode: this.mode,
      mySlot: this.mySlot,
      roomCode: this.roomCode,
      epoch: this.epoch,
      joined: this.joined,
      roster: this.roster,
      rttMs: Math.round(this.conn.rttMs),
      seq: this.world ? this.world.predictor.sequence : this.seq,
      prediction: this.world
        ? { ...this.world.predictor.counters, synced: this.world.predictor.isSynced, epoch: this.world.predictor.worldEpoch, lastIgnored: this.world.predictor.lastIgnored }
        : null,
      snapshotsReceived: this.snapshotsReceived,
      interpSize: this.interp.size,
      stale: this.interp.stale,
      fps: this.fps,
      poses: this.lastPoses.map((p) => ({
        slot: p.slot,
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        speed: vlen(p.linvel),
        extrapolated: p.extrapolated,
        visible: p.visible,
      })),
    };
  }
}

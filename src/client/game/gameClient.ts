import * as THREE from 'three';
import { ARENA_IDS, getArena, type ArenaId } from '../../shared/arenas';
import { CAR_FORWARD, NET, PHYSICS } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatRotate, vdot, vlen } from '../../shared/math';
import type { PlayerInfo, ServerMessage } from '../../shared/protocol';
import { steeringAngle } from '../../shared/vehicle';
import { Connection } from '../net/connection';
import { LagSocket, type LagOptions } from '../net/latency';
import { formatNetStats } from '../net/netStats';
import { ClientSession, type DrawPose, type NetMode } from '../net/session';
import { AutoQuality, QUALITY, lowerQuality, nextQuality, type Quality, type Settings } from '../settings';
import type { Hud } from '../ui/hud';
import type { JoinChoice } from '../ui/menu';
import { AudioEngine, type Listener } from './audio';
import { CountdownBeeper } from './audioParams';
import { applyChaseView, ChaseCamera } from './camera';
import { CarView } from './carView';
import { FxDirector } from './fx';
import { KeyboardInput } from './input';
import { MatchState } from './matchState';
import { NameTag } from './nameTag';
import type { GameScene } from './scene';
import { CanvasMarks } from './skidMarks';
import { SpectatorCamera, cycleDirection } from './spectator';
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
  /** The player's settings, and what to do when the game changes them (the G key, an automatic step down, M). */
  settings: Settings;
  onSettings(settings: Settings): void;
}

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
  private readonly audio = new AudioEngine();
  private readonly beeper = new CountdownBeeper();
  private readonly marks = new CanvasMarks();
  private readonly fx: FxDirector;
  private readonly drawingSize = new THREE.Vector2();
  private readonly auto = new AutoQuality();
  private settings: Settings;
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
  /** The car the camera follows (yours, or the one being watched): the point sound is heard from. */
  private focus: DrawPose | null = null;
  private statsVisible = false;
  private raf = 0;
  private stopped = false;
  private frames = 0;
  private fps = 0;
  /** Milliseconds of script per frame, smoothed (what this machine's processor spends; the graphics card is not included). */
  private frameMs = 0;
  private fpsAt = performance.now();
  private statsAt = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.settings = { ...opts.settings };
    this.session = new ClientSession(opts.net ?? 'predict', {
      onFallback: (reason) => {
        console.error('Prediction unavailable, falling back to interpolation:', reason);
        this.opts.hud.showNotice('Prediction unavailable — using interpolation.');
      },
      onStall: () => this.opts.hud.showNotice('Connection unstable — the server is not receiving your controls.'),
    });
    this.timer.connect(document);
    this.fx = new FxDirector({
      scene: opts.gs.scene,
      audio: this.audio,
      marks: { surface: this.marks, object: this.marks.mesh, upload: () => this.marks.upload() },
      view: (slot) => this.views.get(slot),
    });
    opts.hud.setVoteHandler((arena) => this.castVote(arena));
    this.audio.setVolume(this.settings.volume);
    this.audio.setMuted(this.settings.muted);
    this.applyQuality(this.settings.quality);
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
    if (navigator.userActivation?.isActive) this.audio.unlock(); // inside the click that started the game; otherwise the first key or click does it
    window.addEventListener('pointerdown', this.unlockAudio);
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
    window.removeEventListener('pointerdown', this.unlockAudio);
    this.fx.dispose();
    this.marks.dispose();
    this.audio.dispose();
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
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null, getArena(m.arena));
        this.match.onWelcome(m);
        this.applyRoster();
        this.fx.onWelcome(m.dents); // the cars of a round in progress are dented and stripped as the players saw them
        this.opts.hud.setRoom(m.room.code, m.room.public);
        break;
      case 'roster':
        this.epoch = m.epoch;
        this.roster = m.players;
        this.mySlot = m.you; // slots are per round
        this.session.onRoster(m.epoch, m.you, getArena(m.arena)); // a new world: drop everything buffered or predicted
        this.chase.reset(); // and start the camera at the new spawn
        this.spectator.reset();
        this.match.onRoster(m);
        this.applyRoster();
        this.fx.onRoster();
        break;
      case 'votes':
        this.match.onVotes(m);
        break;
      case 'phase':
        this.session.onPhase(m.phase);
        this.match.onPhase(m);
        break;
      case 'hit':
        this.match.onHit(m);
        this.fx.onHit(m, { poses: this.lastPoses, mySlot: this.mySlot, listener: this.listener() });
        break;
      case 'ko':
        this.match.onKo(m);
        this.fx.onKo(m, { poses: this.lastPoses, listener: this.listener() });
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

  /** A click on an arena card, or a key from 1 to 4: asks the server for it when a vote is open. */
  private castVote(arena: ArenaId): void {
    if (this.match.vote(arena)) this.conn.send({ t: 'vote', arena });
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

  private readonly unlockAudio = (): void => this.audio.unlock();

  /** Puts a graphics preset in force (scene, effects) and remembers it. */
  private applyQuality(quality: Quality): void {
    const profile = QUALITY[quality];
    this.settings = { ...this.settings, quality };
    this.opts.gs.applyQuality(profile);
    this.fx.setDensity(profile.particles, profile.debris);
    this.opts.onSettings(this.settings);
    this.auto.reset(); // the new setting gets its own warm-up before it is judged
  }

  /** Where sound is heard from: the car you drive or watch, or the camera when there is none. */
  private listener(): Listener {
    if (this.focus) return { pos: this.focus.pos, quat: this.focus.quat };
    const c = this.opts.gs.camera;
    return { pos: { x: c.position.x, y: c.position.y, z: c.position.z }, quat: { x: c.quaternion.x, y: c.quaternion.y, z: c.quaternion.z, w: c.quaternion.w } };
  }

  /** F3 shows the network line, H sounds the horn, M mutes, G changes the graphics; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
    this.audio.unlock(); // any key is a gesture the browser accepts
    if (code === 'KeyH') {
      this.audio.horn();
      return;
    }
    if (code === 'KeyM') {
      this.audio.setMuted(!this.audio.muted);
      this.settings = { ...this.settings, muted: this.audio.muted };
      this.opts.onSettings(this.settings);
      this.opts.hud.showNotice(this.audio.muted ? 'Sound off (M)' : 'Sound on (M)');
      return;
    }
    if (code === 'KeyG') {
      this.applyQuality(nextQuality(this.settings.quality));
      this.opts.hud.showNotice(`Graphics: ${this.settings.quality} (G)`);
      return;
    }
    if (code === 'F3') {
      this.statsVisible = !this.statsVisible;
      this.opts.hud.setStatsVisible(this.statsVisible);
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (digit) {
      this.castVote(ARENA_IDS[Number(digit[1]) - 1]!);
      return;
    }
    const direction = cycleDirection(code);
    if (direction !== 0 && !this.driving) this.spectator.cycle(this.lastPoses, direction);
  }

  private readonly frame = (ts: number): void => {
    if (this.stopped) return;
    const started = performance.now();
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
    const bumper = this.keyboard.padCycle(); // read every frame, so a bumper held from earlier is not taken for a new press
    if (bumper !== 0 && !this.driving) this.spectator.cycle(poses, bumper);
    const orbit = this.driving ? null : this.spectator.view(poses, dt);
    if (orbit) applyChaseView(this.opts.gs.camera, orbit);
    else if (mine) this.chase.update(this.opts.gs.camera, { pos: mine.pos, quat: mine.quat, speed: vlen(mine.linvel) }, dt);
    this.match.setWatching(this.driving ? -1 : this.spectator.watching);
    this.match.onCars(poses.filter((p) => p.visible).map((p) => ({ slot: p.slot, hp: p.hp, alive: p.alive, speed: vlen(p.linvel) })));
    const view = this.match.view();
    this.opts.hud.setMatch(view, this.keyboard.isDown('Tab'));
    const beep = this.beeper.next(view);
    if (beep) this.audio.beep(beep);

    // effects: what your own car ran into this tick shows and sounds now; everything else runs from what the server said
    this.focus = this.driving ? (mine ?? null) : (poses.find((p) => p.slot === this.spectator.watching && p.visible) ?? null);
    const listener = this.listener();
    this.fx.onLocalImpacts(this.session.takeImpacts(), { poses, listener });
    const cam = this.opts.gs.camera;
    this.opts.gs.renderer.getDrawingBufferSize(this.drawingSize);
    this.fx.frame({
      dt,
      now: performance.now() / 1000,
      poses,
      mySlot: this.mySlot,
      listener,
      camera: cam,
      pixelScale: this.drawingSize.y / (2 * Math.tan((cam.fov * Math.PI) / 360)),
    });
    if (this.auto.frame(dt)) {
      // the frame rate has stayed low: step down one preset (going back up is the player's choice, with G)
      const lower = lowerQuality(this.settings.quality);
      if (lower) {
        this.applyQuality(lower);
        this.opts.hud.showNotice(`Graphics lowered to ${lower} to keep the frame rate up (G changes it)`);
      }
    }
    this.opts.gs.resize();
    this.opts.gs.render();
    this.updateStats();
    this.frameMs += (performance.now() - started - this.frameMs) * 0.05;
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
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${this.frameMs.toFixed(1)} ms/frame · graphics ${this.settings.quality} · ${net}`);
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
      fx: {
        debris: this.fx.debris.active,
        shake: this.fx.shake.level,
        particles: { spark: this.fx.particles.alive('spark'), smoke: this.fx.particles.alive('smoke'), fire: this.fx.particles.alive('fire'), dust: this.fx.particles.alive('dust') },
        audio: { ready: this.audio.ready, muted: this.audio.muted },
      },
      snapshotsReceived: this.session.snapshotsReceived,
      interpSize: this.session.interpolator.size,
      stale: this.session.interpolator.stale,
      fps: this.fps,
      frameMs: this.frameMs,
      quality: this.settings.quality,
      render: (() => {
        const info = this.opts.gs.renderer.info;
        return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, samples: this.opts.gs.antialiasSamples() };
      })(),
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

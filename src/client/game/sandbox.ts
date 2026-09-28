import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { DRIVE, PHYSICS, SUSPENSION, TIRE } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatNlerp, vlen, vlerp } from '../../shared/math';
import { initPhysics } from '../../shared/physics';
import { Simulation } from '../../shared/sim';
import type { CarState } from '../../shared/types';
import { ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { createGameScene } from './scene';
import { FixedStepper } from './stepper';

export interface SandboxHandle {
  getSim(): Simulation;
  stop(): void;
}

const SLOTS = [0, 1]; // slot 0 is driven by you, slot 1 is a parked target to ram
const COLORS = [0xd84a2b, 0x2b7fd8];

/** Offline driving sandbox: the shared Simulation stepped at a fixed 60 Hz, rendered with interpolation. */
export async function startSandbox(canvas: HTMLCanvasElement, hud: HTMLElement): Promise<SandboxHandle> {
  await initPhysics();
  const gs = createGameScene(canvas);
  const views = COLORS.map((c) => new CarView(c));
  for (const v of views) gs.scene.add(v.group);
  const chase = new ChaseCamera();
  const keyboard = new KeyboardInput();
  const stepper = new FixedStepper(PHYSICS.DT);
  const timer = new THREE.Timer();
  timer.connect(document);

  let sim = new Simulation(SLOTS);
  let prev: CarState[] = SLOTS.map((s) => sim.getState(s));
  let curr: CarState[] = prev;

  const rebuild = (): void => {
    sim.dispose();
    sim = new Simulation(SLOTS);
    prev = SLOTS.map((s) => sim.getState(s));
    curr = prev;
    stepper.reset();
    chase.reset();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') rebuild();
  };
  window.addEventListener('keydown', onKey);

  // Live tuning. DRIVE / TIRE are read every tick; SUSPENSION needs "Rebuild". Copy the JSON into constants.ts to keep changes.
  const gui = new GUI({ title: 'Wreckyard tuning (sandbox only)' });
  const drive = gui.addFolder('Drive');
  drive.add(DRIVE, 'ENGINE', 2000, 20000, 100);
  drive.add(DRIVE, 'REVERSE_SCALE', 0.2, 1, 0.05);
  drive.add(DRIVE, 'BRAKE', 10, 120, 1);
  drive.add(DRIVE, 'HANDBRAKE', 0, 100, 1);
  drive.add(DRIVE, 'MAX_SPEED', 8, 40, 0.5);
  drive.add(DRIVE, 'MAX_STEER', 0.2, 0.9, 0.01);
  drive.add(DRIVE, 'MAX_STEER_FAST', 0.05, 0.5, 0.01);
  const tyres = gui.addFolder('Tyres');
  tyres.add(TIRE, 'SLIP', 0.5, 4, 0.05);
  tyres.add(TIRE, 'HANDBRAKE_SLIP_SCALE', 0.1, 1, 0.05);
  const suspension = gui.addFolder('Suspension (click Rebuild to apply)');
  suspension.add(SUSPENSION, 'STIFFNESS', 10, 60, 1);
  suspension.add(SUSPENSION, 'COMPRESSION', 1, 8, 0.1);
  suspension.add(SUSPENSION, 'RELAXATION', 1, 8, 0.1);
  suspension.add(SUSPENSION, 'MAX_FORCE', 20000, 120000, 1000);
  gui.add({ rebuild }, 'rebuild').name('Rebuild / reset cars (R)');
  gui
    .add(
      {
        copy: (): void => {
          const json = JSON.stringify({ DRIVE, TIRE, SUSPENSION }, null, 2);
          console.log(json);
          void navigator.clipboard?.writeText(json);
        },
      },
      'copy',
    )
    .name('Copy tuning JSON');

  let raf = 0;
  let stopped = false;
  let frames = 0;
  let fps = 0;
  let fpsAt = performance.now();
  let hudAt = 0;

  const frame = (ts: number): void => {
    if (stopped) return;
    timer.update(ts);
    const dt = timer.getDelta();
    const alpha = stepper.advance(dt, () => {
      sim.setInput(0, quantizeInput(keyboard.sample(PHYSICS.DT)));
      prev = curr;
      sim.step();
      curr = SLOTS.map((s) => sim.getState(s));
    });

    SLOTS.forEach((slot, i) => {
      const a = prev[i]!;
      const b = curr[i]!;
      views[i]!.setPose(vlerp(a.pos, b.pos, alpha), quatNlerp(a.quat, b.quat, alpha));
      views[i]!.setWheels(sim.getWheels(slot));
    });
    const a0 = prev[0]!;
    const b0 = curr[0]!;
    const speed = vlen(b0.linvel);
    chase.update(
      gs.camera,
      { pos: vlerp(a0.pos, b0.pos, alpha), quat: quatNlerp(a0.quat, b0.quat, alpha), speed },
      dt,
    );

    frames++;
    const now = performance.now();
    if (now - fpsAt >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
    }
    if (now - hudAt > 100) {
      hudAt = now;
      hud.textContent = `WRECKYARD sandbox\nspeed ${Math.round(speed * 3.6)} km/h   fps ${fps}\nW/S throttle · A/D steer · Space handbrake · R reset`;
    }
    gs.resize();
    gs.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const stop = (): void => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    keyboard.dispose();
    gui.destroy();
    for (const v of views) v.dispose();
    sim.dispose();
    gs.dispose();
  };

  const handle: SandboxHandle = { getSim: () => sim, stop };
  Object.assign(window, { __sandbox: handle }); // handy for automated checks
  return handle;
}

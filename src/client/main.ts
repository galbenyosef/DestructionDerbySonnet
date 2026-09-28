import { spawnPose } from '../shared/arena';
import { webglAvailable } from './game/capabilities';
import { CarView } from './game/carView';
import { createGameScene } from './game/scene';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

function boot(): void {
  if (!webglAvailable()) {
    hud.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  try {
    const gs = createGameScene(canvas);
    [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122].forEach((color, i) => {
      const view = new CarView(color);
      const p = spawnPose(i * 2, 8);
      view.setPose({ x: p.pos.x, y: 1.074, z: p.pos.z }, p.quat);
      gs.scene.add(view.group);
    });
    hud.textContent = 'Wreckyard — arena viewer';
    let t = 0;
    const frame = (): void => {
      t += 0.004;
      gs.camera.position.set(Math.cos(t) * 40, 16, Math.sin(t) * 40);
      gs.camera.lookAt(0, 1, 0);
      gs.resize();
      gs.render();
      requestAnimationFrame(frame);
    };
    frame();
  } catch (err) {
    console.error(err);
    hud.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

boot();

import { webglAvailable } from './game/capabilities';
import { startSandbox } from './game/sandbox';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hud.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  try {
    await startSandbox(canvas, hud);
  } catch (err) {
    console.error(err);
    hud.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();

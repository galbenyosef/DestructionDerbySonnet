import { webglAvailable } from './game/capabilities';
import { GameClient } from './game/gameClient';
import { startSandbox } from './game/sandbox';
import { createGameScene, type GameScene } from './game/scene';
import { serverUrl } from './net/connection';
import { createHud } from './ui/hud';
import { automaticChoice } from './ui/autoChoice';
import { showMenu, type JoinChoice } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const ui = document.getElementById('ui') as HTMLElement;

/** Slow orbit around the arena behind the menu. Returns a function that stops it. */
function startBackdrop(gs: GameScene): () => void {
  let raf = 0;
  let t = 0;
  let running = true;
  const frame = (): void => {
    if (!running) return;
    t += 0.003;
    gs.camera.position.set(Math.cos(t) * 46, 20, Math.sin(t) * 46);
    gs.camera.lookAt(0, 1, 0);
    gs.resize();
    gs.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}

function play(gs: GameScene, choice: JoinChoice): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = serverUrl(location, import.meta.env.VITE_WS_URL as string | undefined);
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve }).start();
  });
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hudEl.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('sandbox')) {
      await startSandbox(canvas, hudEl);
      return;
    }
    hudEl.textContent = '';
    const gs = createGameScene(canvas);
    const initialCode = params.get('room') ?? undefined;
    let auto = automaticChoice(params);
    let error: string | undefined;
    for (;;) {
      const stopBackdrop = startBackdrop(gs);
      const choice = auto ?? (await showMenu(ui, { initialCode, error }));
      auto = null;
      stopBackdrop();
      ui.replaceChildren();
      error = await play(gs, choice); // resolves when the game ends; loop back to the menu with the reason
    }
  } catch (err) {
    console.error(err);
    hudEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();

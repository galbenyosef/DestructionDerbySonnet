import { freezeTuning } from '../shared/constants';
import { initPhysics } from '../shared/physics';
import { simHash } from '../shared/determinism';
import { webglAvailable } from './game/capabilities';
import { GameClient } from './game/gameClient';
import { startSandbox } from './game/sandbox';
import { createGameScene, type GameScene } from './game/scene';
import { serverUrl } from './net/connection';
import { parseLagParams } from './net/latency';
import { QUALITY, loadSettings, saveSettings, type Settings } from './settings';
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

/** localStorage where there is one (some browsers refuse it in private mode). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function play(gs: GameScene, choice: JoinChoice, params: URLSearchParams, settings: Settings, remember: (s: Settings) => void): Promise<string | undefined> {
  let net: 'predict' | 'interp' = params.get('net') === 'interp' ? 'interp' : 'predict';
  if (net === 'predict') {
    try {
      await initPhysics(); // the local simulation needs the WASM physics engine
    } catch (err) {
      console.error('Physics engine failed to load, using interpolation:', err);
      net = 'interp';
    }
  }
  const lag = parseLagParams(params);
  const url = serverUrl(location, import.meta.env.VITE_WS_URL as string | undefined);
  return new Promise((resolve) => {
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve, net, lag, settings, onSettings: remember }).start();
  });
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hudEl.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  const params = new URLSearchParams(location.search);
  if (!params.has('sandbox')) freezeTuning(); // only the offline sandbox may edit the physics tuning
  try {
    if (params.has('sandbox')) {
      await startSandbox(canvas, hudEl);
      return;
    }
    hudEl.textContent = '';
    const gs = createGameScene(canvas);
    const store = browserStorage();
    let settings = loadSettings(store);
    const remember = (s: Settings): void => {
      settings = s;
      saveSettings(store, s);
    };
    gs.applyQuality(QUALITY[settings.quality]);
    if (params.get('bloom') === '0') gs.setBloom(false); // ?bloom=0 turns the glow off, to see what it costs on this machine
    const initialCode = params.get('room') ?? undefined;
    let auto = automaticChoice(params);
    let error: string | undefined;
    for (;;) {
      const stopBackdrop = startBackdrop(gs);
      const choice =
        auto ??
        (await showMenu(ui, {
          initialCode,
          error,
          settings,
          onSettings: (s) => {
            remember(s);
            gs.applyQuality(QUALITY[s.quality]); // the arena behind the menu shows the difference
          },
        }));
      auto = null;
      stopBackdrop();
      ui.replaceChildren();
      error = await play(gs, choice, params, settings, remember); // resolves when the game ends; loop back to the menu with the reason
    }
  } catch (err) {
    console.error(err);
    hudEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Debug hooks: `await __derby.simHash()` hashes a scripted 600-tick simulation, to compare Node against this browser.
Object.assign((window as unknown as { __derby?: object }).__derby ?? ((window as unknown as { __derby: object }).__derby = {}), {
  simHash: async (ticks = 600): Promise<string> => {
    await initPhysics();
    return simHash(ticks);
  },
});

void boot();

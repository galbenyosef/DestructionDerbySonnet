import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';
import { CAR_IDS, CAR_NAMES, type CarId } from '../../shared/cars';
import { CAR_PICTURE_URLS } from '../game/carAssets';
import { PALETTE, loadProfile, saveProfile } from '../profile';
import { QUALITIES, type Quality, type Settings } from '../settings';

export interface JoinChoice {
  name: string;
  color: number;
  car: CarId;
  mode: JoinMode;
  code?: string;
}

export { PALETTE };

/** localStorage, or null where the browser refuses even to name it. */
function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface MenuOptions {
  /** Pre-fills the room-code box (e.g. from an invite link). */
  initialCode?: string;
  error?: string;
  /** The saved settings, shown in the menu, and what to do with a change (the menu applies nothing itself). */
  settings?: Settings;
  onSettings?(settings: Settings): void;
}

/** Renders the main menu into `root` and resolves once the player picks a way to join. */
export function showMenu(root: HTMLElement, options: MenuOptions = {}): Promise<JoinChoice> {
  const profile = loadProfile(safeStorage());
  root.replaceChildren();
  const menu = document.createElement('div');
  menu.className = 'menu';
  // static markup only — user-provided text is always assigned through .value / .textContent below
  menu.innerHTML = `
    <h1>WRECKYARD</h1>
    <p class="tag">Demolition derby arena · last car running wins</p>
    <label>Driver name<input id="m-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
    <div class="cars" id="m-cars" role="radiogroup" aria-label="Car model"></div>
    <div class="swatches" id="m-colors" role="radiogroup" aria-label="Car colour"></div>
    <div class="row"><button id="m-quick" class="primary" type="button">Quick Play</button><button id="m-create" type="button">Create private room</button></div>
    <div class="row"><input id="m-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Room code" /><button id="m-join" type="button">Join with code</button></div>
    <p class="error" id="m-error" role="alert"></p>
    <div class="settings" role="group" aria-label="Settings">
      <label>Graphics<select id="m-quality"></select></label>
      <label>Volume<input id="m-volume" type="range" min="0" max="100" step="5" /></label>
      <label class="check"><input id="m-sound" type="checkbox" />Sound</label>
    </div>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · H horn · M sound · G graphics · Tab scoreboard · F3 network (Fn+F3 on a Mac)</p>`;
  root.append(menu);

  const q = <T extends HTMLElement>(selector: string): T => menu.querySelector<T>(selector)!;
  const nameInput = q<HTMLInputElement>('#m-name');
  const codeInput = q<HTMLInputElement>('#m-code');
  const errorEl = q<HTMLElement>('#m-error');
  const swatches = q<HTMLElement>('#m-colors');
  const cars = q<HTMLElement>('#m-cars');
  nameInput.value = profile.name;
  if (options.initialCode) codeInput.value = options.initialCode.toUpperCase().slice(0, 4);
  if (options.error) errorEl.textContent = options.error;

  const settingsBox = q<HTMLElement>('.settings');
  settingsBox.hidden = !options.settings;
  if (options.settings) {
    let settings = options.settings;
    const quality = q<HTMLSelectElement>('#m-quality');
    for (const name of QUALITIES) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name[0]!.toUpperCase() + name.slice(1);
      quality.append(o);
    }
    const volume = q<HTMLInputElement>('#m-volume');
    const sound = q<HTMLInputElement>('#m-sound');
    quality.value = settings.quality;
    volume.value = String(Math.round(settings.volume * 100));
    sound.checked = !settings.muted;
    const changed = (): void => {
      settings = { quality: quality.value as Quality, volume: Number(volume.value) / 100, muted: !sound.checked };
      options.onSettings?.(settings);
    };
    quality.addEventListener('change', changed);
    volume.addEventListener('input', changed);
    sound.addEventListener('change', changed);
  }

  let car = profile.car;
  for (const id of CAR_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'car';
    b.dataset.car = id;
    const picture = document.createElement('img');
    picture.src = CAR_PICTURE_URLS[id];
    picture.alt = '';
    picture.draggable = false;
    const label = document.createElement('span');
    label.textContent = CAR_NAMES[id];
    b.append(picture, label);
    b.title = CAR_NAMES[id];
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === car));
    b.addEventListener('click', () => {
      car = id;
      for (const c of cars.children) c.setAttribute('aria-checked', String(c === b));
    });
    cars.append(b);
  }

  let color = profile.color;
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex(c);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Car colour ${hex(c)}`);
    b.setAttribute('aria-checked', String(c === color));
    b.addEventListener('click', () => {
      color = c;
      for (const s of swatches.children) s.setAttribute('aria-checked', String(s === b));
    });
    swatches.append(b);
  }

  return new Promise<JoinChoice>((resolve) => {
    const choose = (mode: JoinMode): void => {
      const name = nameInput.value.trim();
      let code: string | undefined;
      if (mode === 'join') {
        const normalized = normalizeRoomCode(codeInput.value);
        if (!normalized) {
          errorEl.textContent = 'Enter a 4-letter room code.';
          codeInput.focus();
          return;
        }
        code = normalized;
      }
      saveProfile(safeStorage(), { name, color, car });
      resolve({ name, color, car, mode, code });
    };
    q('#m-quick').addEventListener('click', () => choose('quick'));
    q('#m-create').addEventListener('click', () => choose('create'));
    q('#m-join').addEventListener('click', () => choose('join'));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') choose('quick');
    });
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') choose('join');
    });
    (options.initialCode ? codeInput : nameInput).focus();
  });
}

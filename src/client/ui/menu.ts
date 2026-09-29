import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';

export interface JoinChoice {
  name: string;
  color: number;
  mode: JoinMode;
  code?: string;
}

export const PALETTE: readonly number[] = [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122, 0x9b59d0, 0x18b5b5, 0xe8527d, 0xe9e9e9];

const STORE_KEY = 'wreckyard.profile';
interface Profile {
  name: string;
  color: number;
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (typeof p.name === 'string' && typeof p.color === 'number' && PALETTE.includes(p.color)) {
        return { name: p.name, color: p.color };
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return { name: '', color: PALETTE[0]! };
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: not fatal */
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface MenuOptions {
  /** Pre-fills the room-code box (e.g. from an invite link). */
  initialCode?: string;
  error?: string;
}

/** Renders the main menu into `root` and resolves once the player picks a way to join. */
export function showMenu(root: HTMLElement, options: MenuOptions = {}): Promise<JoinChoice> {
  const profile = loadProfile();
  root.replaceChildren();
  const menu = document.createElement('div');
  menu.className = 'menu';
  // static markup only — user-provided text is always assigned through .value / .textContent below
  menu.innerHTML = `
    <h1>WRECKYARD</h1>
    <p class="tag">Demolition derby arena · last car running wins</p>
    <label>Driver name<input id="m-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
    <div class="swatches" id="m-colors" role="radiogroup" aria-label="Car colour"></div>
    <div class="row"><button id="m-quick" class="primary" type="button">Quick Play</button><button id="m-create" type="button">Create private room</button></div>
    <div class="row"><input id="m-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Room code" /><button id="m-join" type="button">Join with code</button></div>
    <p class="error" id="m-error" role="alert"></p>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · Tab scoreboard · F3 network</p>`;
  root.append(menu);

  const q = <T extends HTMLElement>(selector: string): T => menu.querySelector<T>(selector)!;
  const nameInput = q<HTMLInputElement>('#m-name');
  const codeInput = q<HTMLInputElement>('#m-code');
  const errorEl = q<HTMLElement>('#m-error');
  const swatches = q<HTMLElement>('#m-colors');
  nameInput.value = profile.name;
  if (options.initialCode) codeInput.value = options.initialCode.toUpperCase().slice(0, 4);
  if (options.error) errorEl.textContent = options.error;

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
      saveProfile({ name, color });
      resolve({ name, color, mode, code });
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

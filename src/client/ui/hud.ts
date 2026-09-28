import type { PlayerInfo } from '../../shared/protocol';

export interface Hud {
  setRoom(code: string, isPublic: boolean): void;
  setPlayers(players: readonly PlayerInfo[], you: number): void;
  setStats(text: string): void;
  /** Shows a short message near the bottom of the screen for a few seconds. */
  showNotice(text: string): void;
  dispose(): void;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function createHud(root: HTMLElement): Hud {
  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'hud';
  const room = document.createElement('div');
  room.className = 'hud-room';
  const list = document.createElement('ul');
  list.className = 'hud-players';
  const stats = document.createElement('div');
  stats.className = 'hud-stats';
  const notice = document.createElement('div');
  notice.className = 'hud-notice';
  notice.setAttribute('role', 'status');
  wrap.append(room, list, stats, notice);
  root.append(wrap);

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (text: string): void => {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = '';
    }, 4000);
  };

  return {
    setRoom(code, isPublic) {
      room.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `${isPublic ? 'Public' : 'Private'} room ${code}`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy invite link';
      copy.addEventListener('click', () => {
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', code);
        const link = url.toString();
        const clipboard = navigator.clipboard; // undefined on plain-http origins such as a LAN address
        if (!clipboard) {
          notify(link);
          return;
        }
        void clipboard.writeText(link).then(
          () => notify('Invite link copied'),
          () => notify(link),
        );
      });
      room.append(label, copy);
    },
    setPlayers(players, you) {
      list.replaceChildren();
      for (const p of players) {
        const li = document.createElement('li');
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = hex(p.color);
        const name = document.createElement('span');
        name.textContent = p.name;
        li.append(chip, name);
        if (p.slot === you) {
          const tag = document.createElement('span');
          tag.className = 'you';
          tag.textContent = 'you';
          li.append(tag);
        }
        list.append(li);
      }
    },
    setStats(text) {
      stats.textContent = text;
    },
    showNotice: notify,
    dispose() {
      if (noticeTimer) clearTimeout(noticeTimer);
      root.replaceChildren();
    },
  };
}

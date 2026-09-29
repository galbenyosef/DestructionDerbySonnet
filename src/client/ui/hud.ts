import type { Zone } from '../../shared/types';
import type { FeedItem, MatchView } from '../game/matchState';
import { hexColor, hpColor, zoneColor } from './format';

export interface Hud {
  setRoom(code: string, isPublic: boolean): void;
  /** Draws the match screen: round clock, health, damage per side, scoreboard, kill feed, banner. `detailed` shows the full scoreboard (Tab). */
  setMatch(view: MatchView, detailed: boolean): void;
  setStats(text: string): void;
  /** F3: the network and frame-rate line at the bottom left. */
  setStatsVisible(visible: boolean): void;
  /** Shows a short message near the bottom of the screen for a few seconds. */
  showNotice(text: string): void;
  dispose(): void;
}

const ZONES: readonly Zone[] = ['front', 'left', 'right', 'rear'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
};
/** Writes only when the value changed: the HUD is refreshed every frame and most frames change nothing. */
const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

export function createHud(root: HTMLElement): Hud {
  root.replaceChildren();
  const wrap = el('div', 'hud');
  const room = el('div', 'hud-room', wrap);

  const round = el('div', 'hud-round', wrap);
  const roundTitle = el('div', 'hud-round-title', round);
  const roundClock = el('div', 'hud-round-clock', round);
  const roundAlive = el('div', 'hud-round-alive', round);

  const board = el('div', 'hud-board', wrap);
  const feed = el('ul', 'hud-feed', wrap);

  const me = el('div', 'hud-me', wrap);
  const zones = el('div', 'hud-zones', me);
  const zoneCells = new Map<Zone, HTMLElement>();
  for (const z of ZONES) zoneCells.set(z, el('i', `zone zone-${z}`, zones));
  el('b', 'zone-car', zones);
  const hpBox = el('div', 'hud-hp', me);
  const hpBar = el('div', 'hp-bar', hpBox);
  const hpFill = el('div', 'hp-fill', hpBar);
  const hpNum = el('div', 'hp-num', hpBox);
  const speed = el('div', 'hud-speed', me);

  const banner = el('div', 'hud-banner', wrap);
  const bannerTitle = el('div', 'banner-title', banner);
  const bannerSub = el('div', 'banner-sub', banner);
  const bannerHint = el('div', 'banner-hint', banner);
  const flash = el('div', 'hud-flash', wrap);
  const stats = el('div', 'hud-stats', wrap);
  stats.hidden = true;
  const notice = el('div', 'hud-notice', wrap);
  notice.setAttribute('role', 'status');
  root.append(wrap);

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (text: string): void => {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = '';
    }, 4000);
  };

  let boardKey = '';
  const feedNodes = new Map<number, HTMLElement>();

  const drawBoard = (view: MatchView, detailed: boolean): void => {
    const key = JSON.stringify([detailed, view.board]);
    if (key === boardKey) return;
    boardKey = key;
    board.replaceChildren();
    board.classList.toggle('detailed', detailed);
    view.board.forEach((r, i) => {
      const row = el('div', `row${r.you ? ' you' : ''}${r.alive ? '' : ' out'}`, board);
      el('span', 'rank', row).textContent = String(i + 1);
      const chip = el('span', 'chip', row);
      chip.style.background = hexColor(r.color);
      el('span', 'name', row).textContent = r.bot ? `${r.name} · bot` : r.name;
      if (detailed) {
        el('span', 'stat', row).textContent = `${r.kills} K`;
        el('span', 'stat', row).textContent = r.alive ? `${Math.ceil(r.hp)} HP` : 'out';
      }
      el('span', 'score', row).textContent = String(r.score);
    });
  };

  const drawFeed = (items: readonly FeedItem[]): void => {
    const live = new Set(items.map((f) => f.id));
    for (const [id, node] of feedNodes) {
      if (!live.has(id)) {
        node.remove();
        feedNodes.delete(id);
      }
    }
    for (const f of items) {
      let node = feedNodes.get(f.id);
      if (!node) {
        node = el('li', `feed-${f.tone}`, feed);
        node.textContent = f.text;
        feedNodes.set(f.id, node);
      }
      node.style.opacity = String(Math.min(1, f.life * 3).toFixed(2));
    }
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
    setMatch(view, detailed) {
      round.hidden = view.phase === null;
      setText(roundTitle, `Round ${view.round}`);
      setText(roundClock, `${view.clockLabel} ${view.clock}`);
      setText(roundAlive, `Alive ${view.aliveCount}/${view.carCount}`);
      drawBoard(view, detailed);
      drawFeed(view.feed);
      me.hidden = view.me === null;
      if (view.me) {
        const hp = Math.max(0, view.me.hp);
        hpFill.style.width = `${hp}%`;
        hpFill.style.background = hpColor(hp);
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
        for (const z of ZONES) zoneCells.get(z)!.style.background = zoneColor(view.me.zones[z]);
        setText(speed, `${view.speedKmh} km/h`);
      }
      banner.hidden = view.banner === null;
      banner.dataset.kind = view.banner?.kind ?? '';
      if (view.banner) {
        setText(bannerTitle, view.banner.title);
        setText(bannerSub, view.banner.subtitle);
        setText(bannerHint, view.banner.hint);
      }
      flash.style.opacity = view.flash.toFixed(2);
    },
    setStats(text) {
      setText(stats, text);
    },
    setStatsVisible(visible) {
      stats.hidden = !visible;
    },
    showNotice: notify,
    dispose() {
      if (noticeTimer) clearTimeout(noticeTimer);
      root.replaceChildren();
    },
  };
}

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { clamp } from '../shared/math';

const out = document.getElementById('out')!;
const log = (s: string): void => {
  out.textContent += `\n${s}`;
};

async function main(): Promise<void> {
  await RAPIER.init();
  log(`three r${THREE.REVISION}, rapier ${RAPIER.version()}, clamp(5,0,1)=${clamp(5, 0, 1)}`);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send('hello');
  ws.onmessage = (e) => log(`echo: ${String(e.data)}`);
}

void main();

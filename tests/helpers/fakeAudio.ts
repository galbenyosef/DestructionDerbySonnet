import { AudioEngine } from '../../src/client/game/audio';

/** Stand-ins for the browser's AudioContext and its nodes: they record what was made and which parameters were set. */
export class Param {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(v: number): void {
    this.value = v;
    this.targets.push(v);
  }
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {}
}
export class Node {
  gain = new Param();
  frequency = new Param();
  pan = new Param();
  Q = new Param();
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  connectedTo: Node[] = [];
  connect(n: Node): Node {
    this.connectedTo.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnected++;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}
export class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new Node();
  nodes: Node[] = [];
  resumed = 0;
  closed = 0;
  private make(): Node {
    const n = new Node();
    this.nodes.push(n);
    return n;
  }
  createGain = () => this.make();
  createOscillator = () => this.make();
  createBiquadFilter = () => this.make();
  createStereoPanner = () => this.make();
  createBufferSource = () => this.make();
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  async resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closed++;
    this.state = 'closed';
  }
}
export const engineWith = (ctx: FakeContext | null | (() => never)) => new AudioEngine((typeof ctx === 'function' ? ctx : () => ctx) as unknown as () => AudioContext | null);

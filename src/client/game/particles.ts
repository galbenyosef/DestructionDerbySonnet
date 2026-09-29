import * as THREE from 'three';

export type ParticleKind = 'spark' | 'smoke' | 'fire' | 'dust';

/** One particle to emit: where and how fast it starts (world frame), how long it lives, how big it starts and a seed for variety. */
export interface Emission {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  seed?: number;
}

const NEVER = -1e9;
const MAX_LIFE = 10;
const MAX_SIZE = 20;

/**
 * The storage of one particle pool: a ring buffer of fixed size. A new particle overwrites the oldest one, so nothing is ever
 * allocated or freed while the game runs, and each frame only the slots written since the last upload have to be sent to the GPU.
 * The particles themselves are never moved by code: the vertex shader works out where each one is from its birth time.
 */
export class ParticleRing {
  readonly origin: Float32Array;
  readonly velocity: Float32Array;
  readonly birth: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly seed: Float32Array;
  /** Index the next particle goes to. */
  head = 0;
  private dirtyFrom = 0;
  private dirtyCount = 0;

  constructor(readonly capacity: number) {
    this.origin = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.birth = new Float32Array(capacity).fill(NEVER);
    this.life = new Float32Array(capacity).fill(1);
    this.size = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
  }

  /** Puts a particle in the ring at time `now` (seconds). Returns its index, or -1 when the numbers are not usable. */
  emit(e: Emission, now: number): number {
    const numbers = [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.life, e.size, now];
    if (!numbers.every(Number.isFinite) || e.life <= 0 || e.size <= 0) return -1;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.origin.set([e.x, e.y, e.z], i * 3);
    this.velocity.set([e.vx, e.vy, e.vz], i * 3);
    this.birth[i] = now;
    this.life[i] = Math.min(e.life, MAX_LIFE);
    this.size[i] = Math.min(e.size, MAX_SIZE);
    this.seed[i] = e.seed ?? 0;
    if (this.dirtyCount === 0) this.dirtyFrom = i;
    this.dirtyCount = Math.min(this.capacity, this.dirtyCount + 1);
    return i;
  }

  /** How many particles are alive at `now`. Birth times are stored as 32-bit floats, so `now` is rounded the same way before comparing. */
  aliveAt(now: number): number {
    const t = Math.fround(now);
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = t - this.birth[i]!;
      if (age >= 0 && age < this.life[i]!) n++;
    }
    return n;
  }

  /** The slots written since the last `clearDirty`: `[from, count]`, or null when nothing was; `wrapped` when it passes the end of the ring. */
  dirty(): { from: number; count: number; wrapped: boolean } | null {
    if (this.dirtyCount === 0) return null;
    return { from: this.dirtyFrom, count: this.dirtyCount, wrapped: this.dirtyFrom + this.dirtyCount > this.capacity };
  }

  clearDirty(): void {
    this.dirtyCount = 0;
  }
}

/** How each kind looks and moves. Gravity in m/s², drag per second, growth in world units per second of age. */
const LOOKS: Record<ParticleKind, { gravity: [number, number, number]; drag: number; grow: number; additive: boolean; colour: string; capacity: number }> = {
  spark: {
    gravity: [0, -9, 0],
    drag: 0.6,
    grow: 0,
    additive: true,
    // white-hot to orange, fading out
    colour: 'vec3 c = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.45, 0.08), t); float a = (1.0 - t) * soft; gl_FragColor = vec4(c * 2.2, a);',
    capacity: 1024,
  },
  fire: {
    gravity: [0, 2.5, 0],
    drag: 1.2,
    grow: 0.9,
    additive: true,
    colour: 'vec3 c = mix(vec3(1.0, 0.85, 0.3), vec3(0.9, 0.18, 0.02), smoothstep(0.0, 0.7, t)); float a = pow(1.0 - t, 1.5) * soft * 0.9; gl_FragColor = vec4(c * 1.6, a);',
    capacity: 512,
  },
  smoke: {
    gravity: [0, 1.4, 0],
    drag: 0.9,
    grow: 1.6,
    additive: false,
    colour: 'float g = 0.16 + 0.12 * vSeed; float a = (1.0 - t) * soft * 0.42; gl_FragColor = vec4(vec3(g), a);',
    capacity: 768,
  },
  dust: {
    gravity: [0, -0.6, 0],
    drag: 2.4,
    grow: 1.1,
    additive: false,
    colour: 'vec3 c = vec3(0.42, 0.33, 0.24); float a = (1.0 - t) * soft * 0.3; gl_FragColor = vec4(c, a);',
    capacity: 768,
  },
};

const VERTEX = /* glsl */ `
attribute vec3 aVelocity;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform vec3 uGravity;
uniform float uDrag;
uniform float uGrow;
uniform float uScale;
varying float vAge;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  vAge = t;
  vSeed = aSeed;
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float travel = (1.0 - exp(-uDrag * age)) / uDrag;
  vec3 p = position + aVelocity * travel + 0.5 * uGravity * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (aSize + uGrow * age) * uScale / -mv.z;
}
`;

const fragment = (colour: string): string => /* glsl */ `
varying float vAge;
varying float vSeed;
void main() {
  float t = vAge;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = 1.0 - r * r;
  ${colour}
}
`;

/**
 * Sparks, fire, smoke and dust for the whole scene: four `THREE.Points` objects, each a ring buffer the GPU animates from the
 * birth time of every particle (one uniform, `uTime`, is all that changes per frame). Emitting costs a few array writes.
 */
export class ParticleSystem {
  readonly object = new THREE.Group();
  private readonly rings = new Map<ParticleKind, ParticleRing>();
  private readonly points = new Map<ParticleKind, THREE.Points>();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private now = 0;

  constructor() {
    for (const kind of Object.keys(LOOKS) as ParticleKind[]) {
      const look = LOOKS[kind];
      const ring = new ParticleRing(look.capacity);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(ring.origin, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aVelocity', new THREE.BufferAttribute(ring.velocity, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aBirth', new THREE.BufferAttribute(ring.birth, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aLife', new THREE.BufferAttribute(ring.life, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(ring.size, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(ring.seed, 1).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: fragment(look.colour),
        uniforms: {
          uTime: { value: 0 },
          uGravity: { value: new THREE.Vector3(...look.gravity) },
          uDrag: { value: look.drag },
          uGrow: { value: look.grow },
          uScale: { value: 400 },
        },
        transparent: true,
        depthWrite: false,
        blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false; // the shader moves the points; the geometry's own bounds mean nothing
      points.renderOrder = 20;
      this.object.add(points);
      this.rings.set(kind, ring);
      this.points.set(kind, points);
      this.materials.push(material);
    }
  }

  /** Emits one particle of `kind` at the current time. */
  emit(kind: ParticleKind, e: Emission): void {
    this.rings.get(kind)!.emit(e, this.now);
  }

  /** How many particles of `kind` are alive right now. */
  alive(kind: ParticleKind): number {
    return this.rings.get(kind)!.aliveAt(this.now);
  }

  /**
   * Once per frame: sets the clock and the pixel scale (`viewportHeight / (2 tan(fov / 2))`, so a size in metres is a size on
   * screen) and uploads what was emitted since the last frame.
   */
  update(nowSeconds: number, pixelScale: number): void {
    this.now = nowSeconds;
    for (const kind of this.rings.keys()) {
      const ring = this.rings.get(kind)!;
      const material = this.points.get(kind)!.material as THREE.ShaderMaterial;
      material.uniforms.uTime!.value = nowSeconds;
      material.uniforms.uScale!.value = pixelScale;
      const dirty = ring.dirty();
      if (!dirty) continue;
      const geometry = this.points.get(kind)!.geometry;
      for (const [name, itemSize] of [['position', 3], ['aVelocity', 3], ['aBirth', 1], ['aLife', 1], ['aSize', 1], ['aSeed', 1]] as const) {
        const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        if (!dirty.wrapped) attribute.addUpdateRange(dirty.from * itemSize, dirty.count * itemSize);
        else {
          attribute.addUpdateRange(dirty.from * itemSize, (ring.capacity - dirty.from) * itemSize);
          attribute.addUpdateRange(0, (dirty.from + dirty.count - ring.capacity) * itemSize);
        }
        attribute.needsUpdate = true;
      }
      ring.clearDirty();
    }
  }

  /** Forgets every particle (a new round). */
  clear(): void {
    for (const [kind, ring] of this.rings) {
      ring.birth.fill(NEVER);
      ring.head = 0;
      ring.clearDirty();
      const attribute = this.points.get(kind)!.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const points of this.points.values()) points.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.removeFromParent();
  }
}

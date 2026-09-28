/** Fixed-timestep accumulator. Frame times are clamped so a backgrounded tab cannot fast-forward the physics. */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly dt: number,
    private readonly maxFrame = 0.1,
  ) {}

  /** Advances by a frame time, calls `step` once per whole tick, and returns the interpolation alpha in [0, 1). */
  advance(frameSeconds: number, step: () => void): number {
    const f = Number.isFinite(frameSeconds) ? Math.min(Math.max(frameSeconds, 0), this.maxFrame) : 0;
    this.acc += f;
    while (this.acc >= this.dt) {
      step();
      this.acc -= this.dt;
    }
    return this.acc / this.dt;
  }

  reset(): void {
    this.acc = 0;
  }
}

import { describe, expect, it } from 'vitest';
import { SKID, SkidMarks, hexToRgb, skidStrength, worldToTexture, type MarkSurface } from '../../src/client/game/skidMarks';

class Recorder implements MarkSurface {
  lines: Array<[number, number, number, number, number, number]> = [];
  cleared = 0;
  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void {
    this.lines.push([x0, y0, x1, y1, width, alpha]);
  }
  clear(): void {
    this.cleared++;
  }
}
const rolling = { forward: 12, lateral: 0, handbrake: false, grounded: true, throttle: 1 };

describe('worldToTexture', () => {
  it('puts the middle of the arena in the middle of the texture and its edges on the texture\'s edges', () => {
    expect(worldToTexture(0, 0)).toEqual({ u: SKID.SIZE / 2, v: SKID.SIZE / 2 });
    expect(worldToTexture(-SKID.EXTENT, -SKID.EXTENT)).toEqual({ u: 0, v: 0 });
    const far = worldToTexture(SKID.EXTENT, SKID.EXTENT);
    expect([far.u, far.v]).toEqual([SKID.SIZE, SKID.SIZE]);
  });

  it('runs down the canvas as z grows, the way the ground plane is turned', () => {
    expect(worldToTexture(0, 10).v).toBeGreaterThan(worldToTexture(0, -10).v);
    expect(worldToTexture(10, 0).u).toBeGreaterThan(worldToTexture(-10, 0).u);
  });
});

describe('skidStrength', () => {
  it('is zero for a car that just rolls, and for one in the air', () => {
    expect(skidStrength(rolling)).toBe(0);
    expect(skidStrength({ ...rolling, lateral: 20, handbrake: true, grounded: false })).toBe(0);
  });

  it('grows as the car slides further sideways, up to a full skid', () => {
    const at = (lateral: number) => skidStrength({ ...rolling, lateral });
    expect(at(2)).toBe(0);
    expect(at(4)).toBeGreaterThan(0);
    expect(at(6)).toBeGreaterThan(at(4));
    expect(at(30)).toBe(1);
    expect(at(-6)).toBe(at(6)); // either way
  });

  it('locks the tyres with the handbrake at speed, and standing on the brake from a high speed', () => {
    expect(skidStrength({ ...rolling, handbrake: true })).toBeGreaterThanOrEqual(0.7);
    expect(skidStrength({ ...rolling, handbrake: true, forward: 1 })).toBe(0); // too slow to matter
    expect(skidStrength({ ...rolling, throttle: -1 })).toBeGreaterThan(0);
    expect(skidStrength({ ...rolling, throttle: -1, forward: 4 })).toBe(0);
    expect(skidStrength({ ...rolling, throttle: -1, forward: -12 })).toBe(0); // reversing is not braking
  });

  it('copes with broken numbers', () => {
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
});

describe('the colour of the marks', () => {
  it('reads #rrggbb into three numbers, and falls back to the dark default for anything else', () => {
    expect(hexToRgb('#2a4a6a')).toEqual([42, 74, 106]);
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
    for (const bad of ['', 'red', '#12345', '#gggggg', '2a4a6a']) expect(hexToRgb(bad)).toEqual([8, 6, 4]);
  });

  it('tells the surface the colour of the ground it is drawn on', () => {
    const seen: string[] = [];
    const surface = new Recorder();
    (surface as MarkSurface).setColor = (c) => seen.push(c);
    new SkidMarks(surface).setColor('#2a4a6a');
    expect(seen).toEqual(['#2a4a6a']);
  });
});

describe('marks on an arena of another size', () => {
  it('maps the world onto the texture by the extent it is given', () => {
    expect(worldToTexture(0, 0, 70)).toEqual({ u: SKID.SIZE / 2, v: SKID.SIZE / 2 });
    expect(worldToTexture(-70, -70, 70)).toEqual({ u: 0, v: 0 });
    expect(worldToTexture(70, 0, 70).u).toBe(SKID.SIZE);
  });

  it('draws with the new scale after the arena changes', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.setExtent(70);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(0, 1, 0, 1);
    const [x0, , x1, , width] = surface.lines[0]!;
    expect(x0).toBe(SKID.SIZE / 2);
    expect(x1).toBeCloseTo(SKID.SIZE / 2 + SKID.SIZE / 140, 9);
    expect(width).toBeCloseTo(SKID.WIDTH * (SKID.SIZE / 140), 9);
  });

  it('tells the surface about the new extent and wipes it', () => {
    const surface = new Recorder();
    const seen: number[] = [];
    (surface as MarkSurface).setExtent = (e) => seen.push(e);
    const marks = new SkidMarks(surface);
    marks.setExtent(64);
    expect(seen).toEqual([64]);
    expect(surface.cleared).toBeGreaterThan(0);
  });
});

describe('SkidMarks', () => {
  it('draws a line from where a skidding wheel was to where it is, and only from the second frame on', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, 0, 0, 1);
    expect(surface.lines).toHaveLength(0);
    expect(marks.takeDirty()).toBe(false);
    marks.wheel(0, 1, 0, 1);
    expect(surface.lines).toHaveLength(1);
    const [x0, y0, x1, y1, width, alpha] = surface.lines[0]!;
    expect([x0, y0]).toEqual([worldToTexture(0, 0).u, worldToTexture(0, 0).v]);
    expect([x1, y1]).toEqual([worldToTexture(1, 0).u, worldToTexture(1, 0).v]);
    expect(width).toBeCloseTo(SKID.WIDTH * (SKID.SIZE / (2 * SKID.EXTENT)), 9);
    expect(alpha).toBeCloseTo(SKID.ALPHA, 9);
    expect(marks.takeDirty()).toBe(true);
    expect(marks.takeDirty()).toBe(false); // once
  });

  it('breaks the line when the wheel stops skidding, and darkens it with the strength of the skid', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(3, 0, 0, 0.5);
    marks.wheel(3, 1, 0, 0.5);
    marks.wheel(3, 2, 0, 0); // rolling again
    marks.wheel(3, 3, 0, 0.5); // a new line starts here: no segment back to (2, 0)
    marks.wheel(3, 4, 0, 1);
    expect(surface.lines).toHaveLength(2);
    expect(surface.lines[0]![5]).toBeCloseTo(SKID.ALPHA * 0.5, 9);
    expect(surface.lines[1]![5]).toBeCloseTo(SKID.ALPHA, 9);
  });

  it('keeps every wheel\'s line apart, and never draws a line across a teleport', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(1, 20, 20, 1);
    marks.wheel(0, 1, 0, 1);
    marks.wheel(1, 21, 20, 1);
    expect(surface.lines).toHaveLength(2);
    marks.wheel(0, 30, -30, 1); // a jump of 40 m in one frame
    expect(surface.lines).toHaveLength(2);
  });

  it('ignores broken numbers and wipes the ground for a new round', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, Number.NaN, 0, 1);
    marks.wheel(0, 0, 0, Number.NaN);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(0, 1, 0, 1);
    expect(surface.lines).toHaveLength(1);
    marks.clear();
    expect(surface.cleared).toBe(1);
    marks.wheel(0, 2, 0, 1); // the wheel's last position was forgotten too
    expect(surface.lines).toHaveLength(1);
    expect(marks.takeDirty()).toBe(true);
  });
});

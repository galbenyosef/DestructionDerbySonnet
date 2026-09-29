import { describe, expect, it } from 'vitest';
import { hexColor, hpColor, zoneColor } from '../../src/client/ui/format';

describe('hexColor', () => {
  it('writes a 24-bit colour as #rrggbb, padded, and clamps nonsense', () => {
    expect(hexColor(0xd84a2b)).toBe('#d84a2b');
    expect(hexColor(0x0000ff)).toBe('#0000ff');
    expect(hexColor(0)).toBe('#000000');
    expect(hexColor(-5)).toBe('#000000');
    expect(hexColor(0x1ffffff)).toBe('#ffffff');
  });
});

describe('hpColor', () => {
  it('runs from red at 0 through amber to green at 100', () => {
    expect(hpColor(0)).toBe('hsl(0, 80%, 48%)');
    expect(hpColor(50)).toBe('hsl(60, 80%, 48%)');
    expect(hpColor(100)).toBe('hsl(120, 80%, 48%)');
  });

  it('stays within that range whatever it is given', () => {
    expect(hpColor(250)).toBe(hpColor(100));
    expect(hpColor(-20)).toBe(hpColor(0));
    expect(hpColor(Number.NaN)).toBe(hpColor(0));
  });
});

describe('zoneColor', () => {
  it('is a faint tint when nothing hit that side and solid red from 40 HP of damage', () => {
    expect(zoneColor(0)).toBe('hsla(55, 90%, 55%, 0.16)');
    expect(zoneColor(40)).toBe('hsla(0, 90%, 55%, 1.00)');
    expect(zoneColor(400)).toBe(zoneColor(40));
  });

  it('darkens steadily with damage', () => {
    const alpha = (d: number): number => Number(/, ([0-9.]+)\)$/.exec(zoneColor(d))![1]);
    expect(alpha(10)).toBeGreaterThan(alpha(0));
    expect(alpha(20)).toBeGreaterThan(alpha(10));
    expect(alpha(39)).toBeGreaterThan(alpha(20));
    expect(zoneColor(Number.NaN)).toBe(zoneColor(0));
  });
});

import { describe, expect, it } from 'vitest';
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';

const bodyColor = (view: CarView): number => {
  const material = (view as unknown as { bodyMaterial: { color: { getHex(): number } } }).bodyMaterial;
  return material.color.getHex();
};

describe('CarView wreck look', () => {
  it('chars the body of a wreck and restores the paint for the next round', () => {
    const view = new CarView(0xd84a2b);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.setWreck(true);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(true); // idempotent
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.dispose();
  });

  it('remembers a colour change made while the car is a wreck', () => {
    const view = new CarView(0x112233);
    view.setWreck(true);
    view.setColor(0x445566);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0x445566);
    view.dispose();
  });
});

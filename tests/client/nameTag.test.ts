import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HP_BAR, NameTag, needsNewTag } from '../../src/client/game/nameTag';

// Node has no canvas: the name is drawn by a stand-in that returns a plain sprite.
const plainLabel = (): THREE.Sprite => new THREE.Sprite(new THREE.SpriteMaterial());
const bar = (tag: NameTag): THREE.Sprite => tag.group.children[2] as THREE.Sprite;

describe('NameTag', () => {
  it('starts with a full green bar as wide as the bar is', () => {
    const tag = new NameTag('Rex', plainLabel);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width, 6);
    const c = bar(tag).material.color;
    expect(c.g).toBeGreaterThan(c.r);
  });

  it('shortens the bar from the right and turns it red as the car loses health', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(25, true);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width / 4, 6);
    const c = bar(tag).material.color;
    expect(c.r).toBeGreaterThan(c.g);
  });

  it('keeps the left edge of the bar where it is whatever the health, in the camera-facing plane of the sprite', () => {
    const tag = new NameTag('Rex', plainLabel);
    for (const hp of [100, 80, 33, 5, 0]) {
      tag.update(hp, true);
      const b = bar(tag);
      expect(b.position.x).toBe(0); // a sprite turns to the camera: an offset in the car's own space would slide sideways
      expect(-b.center.x * b.scale.x).toBeCloseTo(-HP_BAR.width / 2, 6);
    }
  });

  it('keeps the bar inside its frame for out-of-range or broken health values', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(250, true);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width, 6);
    tag.update(-40, true);
    expect(bar(tag).scale.x).toBeGreaterThan(0);
    expect(bar(tag).scale.x).toBeLessThan(0.01);
    tag.update(Number.NaN, true);
    expect(bar(tag).scale.x).toBeLessThan(0.01);
  });

  it('hides the whole tag while the car is out and shows it again in the next round', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(0, false);
    expect(tag.group.visible).toBe(false);
    tag.update(100, true);
    expect(tag.group.visible).toBe(true);
  });

  it('releases its materials and leaves the car when disposed', () => {
    const car = new THREE.Group();
    const tag = new NameTag('Rex', plainLabel);
    car.add(tag.group);
    let disposed = 0;
    for (const child of tag.group.children) (child as THREE.Sprite).material.addEventListener('dispose', () => disposed++);
    tag.dispose();
    expect(disposed).toBe(3);
    expect(car.children).toHaveLength(0);
  });
});

describe('needsNewTag', () => {
  const carWith = (tag?: NameTag) => {
    const car = { group: new THREE.Group() };
    if (tag) car.group.add(tag.group);
    return car;
  };

  it('wants a tag for a car that has none', () => {
    expect(needsNewTag(undefined, 'Rex', carWith())).toBe(true);
  });

  it('keeps the tag a car has when the name is the same, and replaces it when the name changed', () => {
    const tag = new NameTag('Rex', plainLabel);
    const car = carWith(tag);
    expect(needsNewTag(tag, 'Rex', car)).toBe(false);
    expect(needsNewTag(tag, 'Max', car)).toBe(true);
  });

  it('wants a new tag when the car was rebuilt, even for the same name: the old tag went with the old car', () => {
    const tag = new NameTag('Rex', plainLabel);
    carWith(tag); // the old car, now thrown away
    expect(needsNewTag(tag, 'Rex', carWith())).toBe(true);
  });
});

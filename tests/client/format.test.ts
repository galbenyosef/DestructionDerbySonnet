import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../../src/client/game/matchState';
import { boardSignature, hexColor, hpColor, once, voteLabel, voteSignature, zoneColor } from '../../src/client/ui/format';

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

describe('once', () => {
  it('writes the first value, then only values that differ from the last one written', () => {
    const written: string[] = [];
    const write = once((v: string) => written.push(v));
    write('a');
    write('a');
    write('b');
    write('a');
    write('a');
    expect(written).toEqual(['a', 'b', 'a']);
  });

  it('writes even a first value that looks like "nothing yet", and treats NaN as unchanged', () => {
    const written: Array<number | undefined> = [];
    const write = once((v: number | undefined) => written.push(v));
    write(undefined);
    write(undefined);
    expect(written).toEqual([undefined]);
    const nan: number[] = [];
    const writeNumber = once((v: number) => nan.push(v));
    writeNumber(Number.NaN);
    writeNumber(Number.NaN);
    expect(nan).toHaveLength(1);
  });
});

describe('boardSignature', () => {
  const row = (over: Partial<BoardRow> = {}): BoardRow => ({ slot: 0, name: 'Ann', color: 0xd84a2b, bot: false, score: 10, kills: 1, alive: true, hp: 80, you: true, ...over });

  it('does not change with health or kills on the compact board, so a car being hurt does not rebuild it', () => {
    const a = boardSignature([row(), row({ slot: 1, name: 'Bob', you: false })], false);
    expect(boardSignature([row({ hp: 41.5, kills: 3 }), row({ slot: 1, name: 'Bob', you: false, hp: 3 })], false)).toBe(a);
  });

  it('changes with anything the compact board draws', () => {
    const base = boardSignature([row()], false);
    for (const over of [{ score: 11 }, { name: 'Anne' }, { alive: false }, { you: false }, { bot: true }, { color: 1 }, { slot: 2 }]) {
      expect(boardSignature([row(over)], false)).not.toBe(base);
    }
    expect(boardSignature([row(), row({ slot: 1 })], false)).not.toBe(base);
  });

  it('adds kills and whole hit points on the detailed board, and tells the two boards apart', () => {
    const base = boardSignature([row()], true);
    expect(boardSignature([row({ kills: 2 })], true)).not.toBe(base);
    expect(boardSignature([row({ hp: 70 })], true)).not.toBe(base);
    expect(boardSignature([row({ hp: 79.2 })], true)).toBe(base); // 80 HP shown either way
    expect(base).not.toBe(boardSignature([row()], false));
  });
});

describe('the vote panel', () => {
  const option = (id: 'stadium' | 'ice' | 'quarry' | 'port', count: number, mine = false) => ({ id, name: id, count, mine });
  const four = (over: Array<[number, boolean]> = []) => ({
    options: (['stadium', 'ice', 'quarry', 'port'] as const).map((id, i) => option(id, over[i]?.[0] ?? 0, over[i]?.[1] ?? false)),
  });

  it('says how many votes an arena has', () => {
    expect(voteLabel(0)).toBe('no votes');
    expect(voteLabel(1)).toBe('1 vote');
    expect(voteLabel(3)).toBe('3 votes');
    expect(voteLabel(Number.NaN)).toBe('no votes');
    expect(voteLabel(-2)).toBe('no votes');
  });

  it('is rebuilt only when a count, your choice or the panel itself changes', () => {
    expect(voteSignature(null)).toBe('');
    const a = voteSignature(four());
    expect(voteSignature(four())).toBe(a);
    expect(voteSignature(four([[0, false], [1, false]]))).not.toBe(a);
    expect(voteSignature(four([[0, false], [0, true]]))).not.toBe(a);
    expect(a).not.toBe('');
  });
});

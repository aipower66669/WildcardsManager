import { describe, expect, it } from 'vitest';
import { GenFolderDeck } from './genFolderDeck.js';
import { createMulberry32 } from './genPrompts.js';

describe('GenFolderDeck', () => {
  it('same seed yields the same Randomize / Recursive folder sequence', () => {
    const load = () => ['a', 'b', 'c', 'd', 'e'];
    const draw = (seed: number) => {
      const deck = new GenFolderDeck(createMulberry32(seed));
      return [deck.next(load), deck.next(load), deck.next(load), deck.next(load)];
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('reseed with a fixed seed restarts that sequence', () => {
    const load = () => ['a', 'b', 'c'];
    const deck = new GenFolderDeck(createMulberry32(99));
    const first = [deck.next(load), deck.next(load), deck.next(load)];
    deck.reseed(createMulberry32(99));
    expect([deck.next(load), deck.next(load), deck.next(load)]).toEqual(first);
  });

  it('visits every folder once per pass, then reshuffles', () => {
    const draws = [0.1, 0.9, 0.2, 0.4];
    let n = 0;
    const rng = () => draws[n++] ?? 0;
    const deck = new GenFolderDeck(rng);
    const load = () => ['a', 'b', 'c'];

    const first = [deck.next(load), deck.next(load), deck.next(load)];
    expect(new Set(first)).toEqual(new Set(['a', 'b', 'c']));

    const second = [deck.next(load), deck.next(load), deck.next(load)];
    expect(new Set(second)).toEqual(new Set(['a', 'b', 'c']));
    expect(second[0]).not.toBe(first[2]);
  });

  it('reset starts a new shuffle instead of continuing the pass', () => {
    const deck = new GenFolderDeck(() => 0);
    const load = () => ['a', 'b'];
    const first = deck.next(load);
    deck.reset();
    const again = [deck.next(load), deck.next(load)];
    expect(new Set(again)).toEqual(new Set(['a', 'b']));
    expect(again).toContain(first);
  });

  it('drops remaining cards that leave the current allowed set', () => {
    const deck = new GenFolderDeck(() => 0);
    const first = deck.next(() => ['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(first);
    // Scope shrinks to b only — leftover a/c must not be drawn.
    expect(deck.next(() => ['b'])).toBe('b');
  });
});
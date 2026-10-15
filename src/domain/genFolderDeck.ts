/**
 * Shuffled round-robin over prompt folders.
 * One pass visits every folder once. The deck is shuffled again before the next pass.
 */

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const deck = items.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = swap;
  }
  return deck;
}

export class GenFolderDeck {
  private deck: string[] = [];
  private index = 0;
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  /**
   * Replace the RNG and clear the current pass.
   * Use a seeded PRNG for fixed Generation seeds; `Math.random` when seed is −1.
   */
  reseed(rng: () => number = Math.random): void {
    this.rng = rng;
    this.reset();
  }

  /** Drop any pass in progress so the next draw starts a new shuffle. */
  reset(): void {
    this.deck = [];
    this.index = 0;
  }

  /**
   * Next folder in the current pass.
   * `load` supplies the current allowed set; remaining cards outside that set
   * are dropped (e.g. Recursive scope changed mid-run).
   */
  next(load: () => string[]): string {
    const choices = load();
    if (choices.length === 0) {
      throw new Error('No prompt folders with !gen.txt to randomize');
    }
    const allowed = new Set(choices);
    const remaining = this.deck
      .slice(this.index)
      .filter((folder) => allowed.has(folder));
    if (remaining.length === 0) {
      const previous =
        this.deck.length > 0 ? this.deck[this.deck.length - 1] : undefined;
      this.deck = shuffle(choices, this.rng);
      if (
        previous !== undefined &&
        allowed.has(previous) &&
        this.deck.length > 1 &&
        this.deck[0] === previous
      ) {
        const swapWith = 1 + Math.floor(this.rng() * (this.deck.length - 1));
        const first = this.deck[0]!;
        this.deck[0] = this.deck[swapWith]!;
        this.deck[swapWith] = first;
      }
      this.index = 0;
    } else {
      this.deck = remaining;
      this.index = 0;
    }
    const folder = this.deck[this.index]!;
    this.index += 1;
    return folder;
  }
}

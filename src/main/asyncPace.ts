/**
 * Min-interval pacer that does NOT grow an unbounded Promise chain.
 * (`mutex = mutex.then(...)` retains every link forever under sustained load.)
 */
export function createIntervalPacer(minIntervalMs: number): () => Promise<void> {
  let lastAt = 0;
  let busy = false;
  const queue: Array<() => void> = [];

  return function pace(): Promise<void> {
    return new Promise<void>((resolve) => {
      const start = () => {
        void (async () => {
          const wait = Math.max(0, minIntervalMs - (Date.now() - lastAt));
          if (wait > 0) {
            await new Promise<void>((r) => setTimeout(r, wait));
          }
          lastAt = Date.now();
          resolve();
          const next = queue.shift();
          if (next) next();
          else busy = false;
        })();
      };

      if (busy) queue.push(start);
      else {
        busy = true;
        start();
      }
    });
  };
}

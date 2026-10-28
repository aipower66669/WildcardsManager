/** Generation is running. The wildcard watcher waits so a save cannot stall the UI. */

let active = false;
const idleListeners = new Set<() => void>();

export function isGenerationActive(): boolean {
  return active;
}

export function setGenerationActive(next: boolean): void {
  if (active === next) return;
  active = next;
  if (!next) {
    for (const listener of idleListeners) listener();
  }
}

export function onGenerationIdle(listener: () => void): () => void {
  idleListeners.add(listener);
  return () => {
    idleListeners.delete(listener);
  };
}

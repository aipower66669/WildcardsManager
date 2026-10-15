import type { MouseEvent, PointerEvent } from 'react';

const startedOnOverlay = new WeakMap<EventTarget, boolean>();

/**
 * Backdrop dismiss props: only close when the press started and ended on the
 * overlay itself. Prevents closing when text-selecting in a field and releasing
 * outside the dialog (the browser fires click on the common ancestor).
 */
export function modalOverlayDismiss(onDismiss: () => void): {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
} {
  return {
    onPointerDown: (event) => {
      startedOnOverlay.set(
        event.currentTarget,
        event.target === event.currentTarget,
      );
    },
    onClick: (event) => {
      const started = startedOnOverlay.get(event.currentTarget) === true;
      startedOnOverlay.delete(event.currentTarget);
      if (started && event.target === event.currentTarget) onDismiss();
    },
  };
}

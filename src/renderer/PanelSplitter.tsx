import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

export type PanelSplitterHandlers = {
  width: number;
  min: number;
  max: number;
  active: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onReset: () => void;
};

export function PanelSplitter({
  kind,
  width,
  min,
  max,
  active,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
  onReset,
}: PanelSplitterHandlers & { kind: 'files' | 'details' }) {
  return (
    <div
      className={`panel-splitter ${kind}-splitter${active ? ' active' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${label}: ${width}px · drag or use arrow keys · double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span />
    </div>
  );
}

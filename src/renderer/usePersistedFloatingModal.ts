import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { FloatingWindowStateDto } from '../shared/contracts';

type DragKind = 'move' | 'resize';

type DragState = {
  kind: DragKind;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
};

const MARGIN = 8;

function clampRect(
  state: FloatingWindowStateDto,
  minW: number,
  minH: number,
): FloatingWindowStateDto {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(vw - MARGIN * 2, Math.max(minW, Math.round(state.width)));
  const height = Math.min(
    vh - MARGIN * 2,
    Math.max(minH, Math.round(state.height)),
  );
  const maxX = Math.max(MARGIN, vw - width - MARGIN);
  const maxY = Math.max(MARGIN, vh - height - MARGIN);
  const x = Math.min(maxX, Math.max(MARGIN, Math.round(state.x)));
  const y = Math.min(maxY, Math.max(MARGIN, Math.round(state.y)));
  return {
    x,
    y,
    width,
    height,
    maximized: state.maximized === true,
  };
}

function defaultRect(
  defaultWidth: number,
  defaultHeight: number,
  minW: number,
  minH: number,
): FloatingWindowStateDto {
  const width = Math.min(window.innerWidth - MARGIN * 2, defaultWidth);
  const height = Math.min(window.innerHeight - MARGIN * 2, defaultHeight);
  return clampRect(
    {
      x: Math.max(MARGIN, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(MARGIN, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
      maximized: false,
    },
    minW,
    minH,
  );
}

/**
 * Floating modal geometry: drag title bar, resize SE corner, maximize.
 * Persists via load/save callbacks (AppData settings).
 */
export function usePersistedFloatingModal(opts: {
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  load: () => Promise<FloatingWindowStateDto | null | undefined>;
  save: (state: FloatingWindowStateDto) => void;
}): {
  ready: boolean;
  maximized: boolean;
  modalStyle: CSSProperties;
  dragging: boolean;
  headerPointerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
  resizePointerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  toggleMaximized: () => void;
} {
  const minW = opts.minWidth ?? 480;
  const minH = opts.minHeight ?? 320;
  const [ready, setReady] = useState(false);
  const [rect, setRect] = useState<FloatingWindowStateDto>(() =>
    defaultRect(opts.defaultWidth, opts.defaultHeight, minW, minH),
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (next: FloatingWindowStateDto) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        opts.save(clampRect(next, minW, minH));
      }, 200);
    },
    [opts, minW, minH],
  );

  useEffect(() => {
    let cancelled = false;
    void opts
      .load()
      .then((saved) => {
        if (cancelled) return;
        if (saved && typeof saved === 'object') {
          setRect(clampRect(saved, minW, minH));
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const applyRect = useCallback(
    (next: FloatingWindowStateDto, persistNow = false) => {
      const clamped = clampRect(next, minW, minH);
      setRect(clamped);
      if (persistNow) persist(clamped);
    },
    [minW, minH, persist],
  );

  const toggleMaximized = useCallback(() => {
    const cur = rectRef.current;
    const next = { ...cur, maximized: !cur.maximized };
    applyRect(next, true);
  }, [applyRect]);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      persist(rectRef.current);
    },
    [persist],
  );

  const onMovePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (rectRef.current.maximized) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, a, input, select, textarea, label')
      ) {
        return;
      }
      event.preventDefault();
      const cur = rectRef.current;
      dragRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: cur.x,
        originY: cur.y,
        originW: cur.width,
        originH: cur.height,
      };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (rectRef.current.maximized) return;
      event.preventDefault();
      event.stopPropagation();
      const cur = rectRef.current;
      dragRef.current = {
        kind: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: cur.x,
        originY: cur.y,
        originW: cur.width,
        originH: cur.height,
      };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.kind === 'move') {
        applyRect({
          ...rectRef.current,
          x: drag.originX + dx,
          y: drag.originY + dy,
          maximized: false,
        });
        return;
      }
      applyRect({
        ...rectRef.current,
        width: drag.originW + dx,
        height: drag.originH + dy,
        maximized: false,
      });
    },
    [applyRect],
  );

  const modalStyle: CSSProperties = rect.maximized
    ? {
        position: 'fixed',
        left: MARGIN,
        top: MARGIN,
        right: MARGIN,
        bottom: MARGIN,
        width: 'auto',
        height: 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
      }
    : {
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        maxWidth: 'none',
        maxHeight: 'none',
      };

  return {
    ready,
    maximized: rect.maximized,
    modalStyle,
    dragging,
    headerPointerProps: {
      onPointerDown: onMovePointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: toggleMaximized,
    },
    resizePointerProps: {
      onPointerDown: onResizePointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    toggleMaximized,
  };
}

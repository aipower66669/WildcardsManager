import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { preserveScrollForRowHeightChange } from '../shared/civitaiVirtualGridScroll';

const DEFAULT_GAP = 12;
/** Typical card height (thumb + body + actions); refined by measuring. */
const DEFAULT_CARD_HEIGHT = 328;
const OVERSCAN_ROWS = 3;
/** Ignore sub-pixel / border noise when comparing measured card heights. */
const HEIGHT_NOISE_PX = 2;

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let parent = node?.parentElement ?? null;
  while (parent) {
    const style = getComputedStyle(parent);
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return parent;
    parent = parent.parentElement;
  }
  return null;
}

function offsetWithinScroller(el: HTMLElement, scroller: HTMLElement): number {
  return (
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

function maxChildHeight(win: HTMLElement): number {
  let max = 0;
  for (const child of win.children) {
    const h = Math.round((child as HTMLElement).getBoundingClientRect().height);
    if (h > max) max = h;
  }
  return max;
}

export function CivitaiVirtualGrid<T>({
  items,
  cardMinWidth,
  getItemKey,
  renderItem,
  className,
  windowClassName = 'civitai-grid civitai-grid-virtual-window',
  gap = DEFAULT_GAP,
  estimateCardHeight = DEFAULT_CARD_HEIGHT,
  overscanRows = OVERSCAN_ROWS,
  onClick,
  onVisibleItems,
  scrollToTopToken = 0,
}: {
  items: readonly T[];
  cardMinWidth: number;
  getItemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  windowClassName?: string;
  gap?: number;
  estimateCardHeight?: number;
  overscanRows?: number;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Cards currently mounted (viewport + overscan). Not the full loaded list. */
  onVisibleItems?: (items: readonly T[]) => void;
  /** Increment to jump this grid back to its first row. */
  scrollToTopToken?: number;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [cardHeight, setCardHeight] = useState(estimateCardHeight);
  const cardHeightRef = useRef(cardHeight);
  cardHeightRef.current = cardHeight;
  const scrollerRef = useRef(scroller);
  scrollerRef.current = scroller;
  /** Tallest card seen for this column/zoom layout — never shrinks while scrolling. */
  const lockedHeightRef = useRef<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setScroller(findScrollParent(root));
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.round(entry.contentRect.width);
      setWidth((prev) => (prev === next ? prev : next));
    });
    ro.observe(root);
    setWidth(root.clientWidth);
    return () => ro.disconnect();
  }, []);

  const syncScroll = useCallback(() => {
    const root = rootRef.current;
    const parent = scroller;
    if (!root || !parent) return;
    const offset = offsetWithinScroller(root, parent);
    const nextTop = Math.max(0, parent.scrollTop - offset);
    const nextHeight = parent.clientHeight;
    setScrollTop((prev) => (Math.abs(prev - nextTop) < 1 ? prev : nextTop));
    setViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
  }, [scroller]);

  useEffect(() => {
    if (!scrollToTopToken) return;
    const root = rootRef.current;
    const parent = scrollerRef.current ?? findScrollParent(root);
    if (!root || !parent) return;
    parent.scrollTop = offsetWithinScroller(root, parent);
    setScrollTop(0);
  }, [scrollToTopToken]);

  useEffect(() => {
    const parent = scroller;
    if (!parent) return;
    syncScroll();
    parent.addEventListener('scroll', syncScroll, { passive: true });
    const ro = new ResizeObserver(() => syncScroll());
    ro.observe(parent);
    return () => {
      parent.removeEventListener('scroll', syncScroll);
      ro.disconnect();
    };
  }, [scroller, syncScroll]);

  const columns = useMemo(() => {
    if (width <= 0) return 1;
    return Math.max(1, Math.floor((width + gap) / (cardMinWidth + gap)));
  }, [width, cardMinWidth, gap]);

  const layoutKey = `${columns}:${cardMinWidth}:${gap}:${estimateCardHeight}`;

  useEffect(() => {
    lockedHeightRef.current = null;
    setCardHeight(estimateCardHeight);
  }, [layoutKey, estimateCardHeight]);

  const applyMeasuredHeight = useCallback(
    (measured: number) => {
      if (measured < 80) return;
      const locked = lockedHeightRef.current;
      if (locked != null && measured <= locked + HEIGHT_NOISE_PX) return;

      const prev = cardHeightRef.current;
      const parent = scrollerRef.current;
      const root = rootRef.current;
      if (parent && root && prev > 0) {
        const offset = offsetWithinScroller(root, parent);
        const rel = Math.max(0, parent.scrollTop - offset);
        parent.scrollTop =
          offset +
          preserveScrollForRowHeightChange(rel, prev + gap, measured + gap);
      }
      lockedHeightRef.current = Math.max(locked ?? 0, measured);
      setCardHeight(lockedHeightRef.current);
    },
    [gap],
  );

  const rowPitch = cardHeight + gap;
  const rowCount = Math.max(1, Math.ceil(items.length / columns) || 1);
  const totalHeight =
    items.length === 0
      ? 0
      : rowCount * cardHeight + Math.max(0, rowCount - 1) * gap;

  const { startRow, endRow } = useMemo(() => {
    if (items.length === 0) return { startRow: 0, endRow: 0 };
    const first = Math.floor(scrollTop / rowPitch);
    const visibleRows = Math.ceil(viewportHeight / rowPitch) + 1;
    return {
      startRow: Math.max(0, first - overscanRows),
      endRow: Math.min(rowCount - 1, first + visibleRows + overscanRows),
    };
  }, [
    items.length,
    scrollTop,
    rowPitch,
    viewportHeight,
    overscanRows,
    rowCount,
  ]);

  const startIndex = startRow * columns;
  const endIndex = Math.min(items.length, (endRow + 1) * columns);
  const offsetY = startRow * rowPitch;

  const visible = useMemo(() => {
    const slice: Array<{ item: T; index: number }> = [];
    for (let i = startIndex; i < endIndex; i += 1) {
      const item = items[i];
      if (item !== undefined) slice.push({ item, index: i });
    }
    return slice;
  }, [items, startIndex, endIndex]);

  const onVisibleItemsRef = useRef(onVisibleItems);
  onVisibleItemsRef.current = onVisibleItems;
  useEffect(() => {
    onVisibleItemsRef.current?.(visible.map((row) => row.item));
  }, [visible]);

  // Measure tallest on-screen card. Height may grow (image load) but never
  // shrink from a shorter card entering the window — that oscillation made
  // the catalog bounce between two scroll positions.
  useEffect(() => {
    const win = windowRef.current;
    if (!win || visible.length === 0) return;
    const measure = () => applyMeasuredHeight(maxChildHeight(win));
    const raf = window.requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(win);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [layoutKey, visible.length, applyMeasuredHeight]);

  const gridStyle = useMemo(
    (): CSSProperties => ({
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: `${gap}px`,
      transform: `translateY(${offsetY}px)`,
    }),
    [columns, gap, offsetY],
  );

  if (items.length === 0) {
    return (
      <div
        ref={rootRef}
        className={className}
        onClick={onClick}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={`civitai-grid-virtual${className ? ` ${className}` : ''}`}
      style={{ height: totalHeight }}
      onClick={onClick}
    >
      <div
        ref={windowRef}
        className={windowClassName}
        style={gridStyle}
      >
        {visible.map(({ item, index }) => (
          <div
            key={getItemKey(item, index)}
            className="civitai-grid-virtual-cell"
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

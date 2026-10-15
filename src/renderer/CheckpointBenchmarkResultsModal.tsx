import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LineChart,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  CheckpointBenchmarkResultRowDto,
  CheckpointBenchmarkResultsDto,
} from '../shared/contracts';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import { usePersistedFloatingModal } from './usePersistedFloatingModal';

export type BenchmarkResultsSort =
  | 'speed-asc'
  | 'speed-desc'
  | 'name-asc'
  | 'name-desc';

type Props = {
  onClose: () => void;
  /** Load this checkpoint into the Generation dropdown. */
  onSelectCheckpoint: (relativePath: string) => void;
};

function formatAvgMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec - min * 60);
  return `${min}m ${rem}s`;
}

function sortRows(
  rows: CheckpointBenchmarkResultRowDto[],
  sort: BenchmarkResultsSort,
): CheckpointBenchmarkResultRowDto[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === 'name-asc') {
      return a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' });
    }
    if (sort === 'name-desc') {
      return b.stem.localeCompare(a.stem, undefined, { sensitivity: 'base' });
    }
    if (sort === 'speed-asc') {
      return (
        a.avgDurationMs - b.avgDurationMs ||
        a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' })
      );
    }
    return (
      b.avgDurationMs - a.avgDurationMs ||
      a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' })
    );
  });
  return copy;
}

type PlotPoint = {
  row: CheckpointBenchmarkResultRowDto;
  x: number;
  y: number;
  yMin: number;
  yMax: number;
  /** Y positions for each individual run. */
  runYs: number[];
  index: number;
};

const PAD = { top: 16, right: 16, bottom: 36, left: 56 };
/** Half-width of the horizontal whisker caps on range bars. */
const RANGE_CAP = 5;
/** Radius of individual-run markers (avg dots stay larger). */
const RUN_DOT_R = 2;

/**
 * Line/scatter chart of Checkpoint Benchmark avg timings.
 * Floating window: drag title, resize corner, maximize — geometry persisted.
 */
export function CheckpointBenchmarkResultsModal({
  onClose,
  onSelectCheckpoint,
}: Props) {
  const [data, setData] = useState<CheckpointBenchmarkResultsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<BenchmarkResultsSort>('speed-asc');
  const [hover, setHover] = useState<{
    row: CheckpointBenchmarkResultRowDto;
    clientX: number;
    clientY: number;
  } | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const plotRoRef = useRef<ResizeObserver | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });

  const {
    ready,
    maximized,
    modalStyle,
    dragging,
    headerPointerProps,
    resizePointerProps,
    toggleMaximized,
  } = usePersistedFloatingModal({
    defaultWidth: 820,
    defaultHeight: 520,
    minWidth: 480,
    minHeight: 320,
    load: async () => {
      const settings = await window.wcm.ui.getSettings();
      return settings.benchmarkResultsWindow;
    },
    save: (state) => {
      void window.wcm.ui.setBenchmarkResultsWindow(state).catch(() => {
        // ignore persistence failures
      });
    },
  });

  const measurePlot = useCallback(() => {
    const el = plotRef.current;
    if (!el) return;
    const w = Math.max(0, Math.floor(el.clientWidth));
    const h = Math.max(0, Math.floor(el.clientHeight));
    setPlotSize((prev) =>
      prev.width === w && prev.height === h ? prev : { width: w, height: h },
    );
  }, []);

  /** Attach when the plot node mounts (after rows load) and on every resize. */
  const setPlotNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (plotRoRef.current) {
        plotRoRef.current.disconnect();
        plotRoRef.current = null;
      }
      plotRef.current = node;
      if (!node) return;
      const ro = new ResizeObserver(() => {
        measurePlot();
      });
      plotRoRef.current = ro;
      ro.observe(node);
      measurePlot();
    },
    [measurePlot],
  );

  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await window.wcm.comfy.getCheckpointBenchmarkResults());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // Floating window geometry changed (drag resize / maximize) — remasure plot.
  useEffect(() => {
    if (!ready) return;
    measurePlot();
    const id = window.requestAnimationFrame(() => measurePlot());
    return () => window.cancelAnimationFrame(id);
  }, [ready, modalStyle, maximized, dragging, measurePlot]);

  const sorted = useMemo(
    () => sortRows(data?.rows ?? [], sort),
    [data?.rows, sort],
  );

  const { points, linePath, yTicks, maxScale } = useMemo(() => {
    const w = plotSize.width;
    const h = plotSize.height;
    const innerW = Math.max(1, w - PAD.left - PAD.right);
    const innerH = Math.max(1, h - PAD.top - PAD.bottom);
    let max = 0;
    for (const row of sorted) {
      if (row.maxDurationMs > max) max = row.maxDurationMs;
      if (row.avgDurationMs > max) max = row.avgDurationMs;
    }
    if (max <= 0) max = 1;
    const yAt = (ms: number) =>
      PAD.top + innerH - (ms / max) * innerH;
    const n = sorted.length;
    const pts: PlotPoint[] = sorted.map((row, i) => {
      const x =
        PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      return {
        row,
        x,
        y: yAt(row.avgDurationMs),
        yMin: yAt(row.minDurationMs),
        yMax: yAt(row.maxDurationMs),
        runYs: (row.runDurationsMs ?? []).map((ms) => yAt(ms)),
        index: i,
      };
    });
    const path =
      pts.length === 0
        ? ''
        : pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ');
    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const t = i / tickCount;
      const ms = max * (1 - t);
      return {
        y: PAD.top + innerH * t,
        label: formatAvgMs(ms),
      };
    });
    return { points: pts, linePath: path, yTicks: ticks, maxScale: max };
  }, [sorted, plotSize]);

  const nearestPoint = (clientX: number, clientY: number): PlotPoint | null => {
    const el = plotRef.current;
    if (!el || points.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: PlotPoint | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    // Only snap when reasonably close (in CSS pixels).
    if (!best || bestDist > 28 * 28) return null;
    return best;
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      {...modalOverlayDismiss(onClose)}
    >
      <div
        className={`modal benchmark-results-modal${
          dragging ? ' is-dragging' : ''
        }${maximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-labelledby="benchmark-results-title"
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className={`modal-head modal-head-draggable${
            dragging ? ' dragging' : ''
          }`}
          title="Drag to move · double-click to maximize"
          {...headerPointerProps}
        >
          <h2 id="benchmark-results-title">
            <LineChart size={18} /> Benchmark results
          </h2>
          <div className="benchmark-results-head-actions">
            <label className="benchmark-results-sort">
              <span className="hint">Sort</span>
              <select
                className="text-input"
                value={sort}
                onChange={(e) =>
                  setSort(e.target.value as BenchmarkResultsSort)
                }
              >
                <option value="speed-asc">Speed · fastest first</option>
                <option value="speed-desc">Speed · slowest first</option>
                <option value="name-asc">Name · A–Z</option>
                <option value="name-desc">Name · Z–A</option>
              </select>
            </label>
            <button
              type="button"
              className="icon-btn"
              disabled={busy}
              title="Refresh from benchmark-stats.json"
              aria-label="Refresh results"
              onClick={() => void reload()}
            >
              <RefreshCw size={14} className={busy ? 'spin' : undefined} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={maximized ? 'Restore' : 'Maximize'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
              onClick={toggleMaximized}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="modal-body benchmark-results-body">
          {error ? <p className="error-text">{error}</p> : null}
          {!error && !data?.root ? (
            <p className="hint">
              Set Checkpoint Benchmark folder in Library Manager first.
            </p>
          ) : null}
          {!error && data?.root && sorted.length === 0 ? (
            <p className="hint">
              No timings yet. Run Generation with Benchmark enabled — the graph
              fills as jobs finish.
            </p>
          ) : null}
          {sorted.length > 0 ? (
            <>
              <p className="hint benchmark-results-legend">
                Avg (blue) · individual runs (amber) · min–max range ·{' '}
                {sorted.length} checkpoints · hover a point for the name · click
                to load it in the Checkpoint dropdown
                {data?.updatedAt
                  ? ` · updated ${new Date(data.updatedAt).toLocaleString()}`
                  : ''}
                {` · scale ${formatAvgMs(maxScale)}`}
              </p>
              <div
                ref={setPlotNode}
                className="benchmark-results-plot"
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                  const hit = nearestPoint(e.clientX, e.clientY);
                  if (!hit) {
                    setHover(null);
                    return;
                  }
                  setHover({
                    row: hit.row,
                    clientX: e.clientX,
                    clientY: e.clientY,
                  });
                }}
                onClick={(e) => {
                  const hit = nearestPoint(e.clientX, e.clientY);
                  if (!hit) return;
                  onSelectCheckpoint(hit.row.relativePath);
                  onClose();
                }}
              >
                {plotSize.width > 0 && plotSize.height > 0 ? (
                <svg
                  className="benchmark-results-svg"
                  width={plotSize.width}
                  height={plotSize.height}
                  viewBox={`0 0 ${plotSize.width} ${plotSize.height}`}
                  role="img"
                  aria-label="Average generation time by checkpoint"
                >
                  {yTicks.map((tick) => (
                    <g key={tick.y}>
                      <line
                        className="benchmark-results-grid"
                        x1={PAD.left}
                        x2={plotSize.width - PAD.right}
                        y1={tick.y}
                        y2={tick.y}
                      />
                      <text
                        className="benchmark-results-axis-label"
                        x={PAD.left - 8}
                        y={tick.y + 3}
                        textAnchor="end"
                      >
                        {tick.label}
                      </text>
                    </g>
                  ))}
                  <line
                    className="benchmark-results-axis"
                    x1={PAD.left}
                    y1={PAD.top}
                    x2={PAD.left}
                    y2={plotSize.height - PAD.bottom}
                  />
                  <line
                    className="benchmark-results-axis"
                    x1={PAD.left}
                    y1={plotSize.height - PAD.bottom}
                    x2={plotSize.width - PAD.right}
                    y2={plotSize.height - PAD.bottom}
                  />
                  <text
                    className="benchmark-results-axis-label"
                    x={(PAD.left + plotSize.width - PAD.right) / 2}
                    y={plotSize.height - 10}
                    textAnchor="middle"
                  >
                    Checkpoints (sorted)
                  </text>
                  {points.map((p) => {
                    const active = hover?.row.stem === p.row.stem;
                    const stem = p.row.stem;
                    return (
                      <g
                        key={stem}
                        className={
                          active
                            ? 'benchmark-results-range is-active'
                            : 'benchmark-results-range'
                        }
                      >
                        <line
                          className="benchmark-results-range-stem"
                          x1={p.x}
                          x2={p.x}
                          y1={p.yMax}
                          y2={p.yMin}
                        />
                        <line
                          className="benchmark-results-range-cap"
                          x1={p.x - RANGE_CAP}
                          x2={p.x + RANGE_CAP}
                          y1={p.yMax}
                          y2={p.yMax}
                        />
                        <line
                          className="benchmark-results-range-cap"
                          x1={p.x - RANGE_CAP}
                          x2={p.x + RANGE_CAP}
                          y1={p.yMin}
                          y2={p.yMin}
                        />
                      </g>
                    );
                  })}
                  {points.map((p) =>
                    p.runYs.map((ry, ri) => (
                      <circle
                        key={`${p.row.stem}-run-${ri}`}
                        className={
                          hover?.row.stem === p.row.stem
                            ? 'benchmark-results-run-dot is-active'
                            : 'benchmark-results-run-dot'
                        }
                        cx={p.x}
                        cy={ry}
                        r={RUN_DOT_R}
                      />
                    )),
                  )}
                  {linePath ? (
                    <path
                      className="benchmark-results-line"
                      d={linePath}
                      fill="none"
                    />
                  ) : null}
                  {points.map((p) => {
                    const active = hover?.row.stem === p.row.stem;
                    return (
                      <circle
                        key={p.row.stem}
                        className={
                          active
                            ? 'benchmark-results-dot is-active'
                            : 'benchmark-results-dot'
                        }
                        cx={p.x}
                        cy={p.y}
                        r={active ? 5 : 3.5}
                      />
                    );
                  })}
                </svg>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {hover ? (
          <div
            className="benchmark-results-tooltip"
            style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}
            role="tooltip"
          >
            <strong>{hover.row.stem}</strong>
            <span>
              {formatAvgMs(hover.row.avgDurationMs)} avg ·{' '}
              {formatAvgMs(hover.row.minDurationMs)}–
              {formatAvgMs(hover.row.maxDurationMs)} · {hover.row.runCount}{' '}
              run{hover.row.runCount === 1 ? '' : 's'} ·{' '}
              {hover.row.imageCount} img
              {hover.row.imageCount === 1 ? '' : 's'}
            </span>
            <span className="hint mono">{hover.row.relativePath}</span>
          </div>
        ) : null}

        {maximized ? null : (
          <div
            className="prompt-coverage-resize-handle"
            title="Drag to resize"
            {...resizePointerProps}
          />
        )}
      </div>
    </div>
  );
}

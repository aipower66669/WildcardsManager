import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Eraser,
  Terminal,
} from 'lucide-react';
import type {
  DownloadLogEntryDto,
  DownloadLogLevel,
} from '../shared/contracts.js';

type LevelFilter = 'all' | DownloadLogLevel;

const LEVEL_RANK: Record<DownloadLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function entryMatches(
  entry: DownloadLogEntryDto,
  level: LevelFilter,
  query: string,
): boolean {
  if (level !== 'all' && LEVEL_RANK[entry.level] < LEVEL_RANK[level]) {
    return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.message,
    entry.detail,
    entry.source,
    entry.modelName,
    entry.modelId != null ? String(entry.modelId) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function DownloadConsole() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DownloadLogEntryDto[]>([]);
  const [level, setLevel] = useState<LevelFilter>('all');
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let flushTimer: number | null = null;
    const pending: DownloadLogEntryDto[] = [];
    const flush = () => {
      flushTimer = null;
      if (cancelled || pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      setEntries((prev) => {
        const next = prev.length === 0 ? batch : prev.concat(batch);
        return next.length > 500 ? next.slice(-500) : next;
      });
    };
    void window.wcm.civitai.listDownloadLog().then((list) => {
      if (!cancelled) setEntries(list);
    });
    const off = window.wcm.civitai.onDownloadLog((entry) => {
      // Retries can log several times per second — coalesce into one React update.
      pending.push(entry);
      if (flushTimer == null) {
        flushTimer = window.setTimeout(flush, 250);
      }
    });
    return () => {
      cancelled = true;
      if (flushTimer != null) window.clearTimeout(flushTimer);
      off();
    };
  }, []);

  const filtered = useMemo(
    () => entries.filter((e) => entryMatches(e, level, query)),
    [entries, level, query],
  );

  const errorCount = useMemo(
    () => entries.filter((e) => e.level === 'error').length,
    [entries],
  );
  const warnCount = useMemo(
    () => entries.filter((e) => e.level === 'warn').length,
    [entries],
  );

  useEffect(() => {
    if (!open || !autoScroll) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered, open, autoScroll]);

  const copyAll = useCallback(async () => {
    const text = filtered
      .map((e) => {
        const meta = [
          formatTime(e.ts),
          e.level.toUpperCase(),
          e.source,
          e.modelName,
        ]
          .filter(Boolean)
          .join(' ');
        return `${meta}  ${e.message}${e.detail ? `\n  ${e.detail}` : ''}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '(empty)');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [filtered]);

  const clear = useCallback(async () => {
    const next = await window.wcm.civitai.clearDownloadLog();
    setEntries(next);
  }, []);

  return (
    <div className={`download-console${open ? ' open' : ''}`}>
      <button
        type="button"
        className="download-console-toggle"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Collapse download console' : 'Expand download console'}
      >
        <Terminal size={13} />
        <span>Download console</span>
        {errorCount > 0 ? (
          <span className="download-console-badge error">{errorCount}</span>
        ) : warnCount > 0 ? (
          <span className="download-console-badge warn">{warnCount}</span>
        ) : entries.length > 0 ? (
          <span className="download-console-badge">{entries.length}</span>
        ) : null}
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {open ? (
        <div className="download-console-panel">
          <div className="download-console-toolbar">
            <div className="download-console-filters">
              {(
                [
                  ['all', 'All'],
                  ['info', 'Info+'],
                  ['warn', 'Warn+'],
                  ['error', 'Error'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    level === value
                      ? 'download-console-chip active'
                      : 'download-console-chip'
                  }
                  onClick={() => setLevel(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="download-console-search"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="download-console-autoscroll">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button
              type="button"
              className="ghost-btn"
              title="Copy visible lines"
              onClick={() => void copyAll()}
            >
              <ClipboardCopy size={13} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="ghost-btn"
              title="Clear console"
              onClick={() => void clear()}
            >
              <Eraser size={13} /> Clear
            </button>
          </div>
          <div className="download-console-list" ref={listRef} role="log">
            {filtered.length === 0 ? (
              <div className="download-console-empty">
                No log lines yet. Download activity, API calls, warnings, and
                errors will appear here.
              </div>
            ) : (
              filtered.map((entry) => (
                <div
                  key={entry.id}
                  className={`download-console-line level-${entry.level}`}
                >
                  <span className="download-console-time">
                    {formatTime(entry.ts)}
                  </span>
                  <span className="download-console-level">
                    {entry.level}
                  </span>
                  {entry.source ? (
                    <span className="download-console-source">
                      {entry.source}
                    </span>
                  ) : null}
                  <span className="download-console-msg">
                    {entry.modelName ? (
                      <span className="download-console-model">
                        [{entry.modelName}]{' '}
                      </span>
                    ) : null}
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

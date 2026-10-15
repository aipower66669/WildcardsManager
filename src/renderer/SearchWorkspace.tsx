import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  HardDrive,
  Layers,
  Search,
  X,
} from 'lucide-react';
import type {
  GlobalSearchHitDto,
  GlobalSearchScopesDto,
} from '../shared/contracts';
import { modalOverlayDismiss } from './modalOverlayDismiss';

export const DEFAULT_SEARCH_SCOPES: GlobalSearchScopesDto = {
  wildcards: true,
  prompts: true,
  loras: true,
  checkpoints: true,
};

export type GlobalSearchState = {
  query: string;
  scopes: GlobalSearchScopesDto;
};

type SearchWorkspaceProps = {
  /** When false, stay mounted but hidden so results survive tab switches. */
  active?: boolean;
  query: string;
  scopes: GlobalSearchScopesDto;
  /** Bumped when the launcher submits (even if query/scopes are unchanged). */
  refreshNonce?: number;
  onQueryChange: (query: string) => void;
  onScopesChange: (scopes: GlobalSearchScopesDto) => void;
  onOpenHit: (hit: GlobalSearchHitDto) => void;
};

function hitKey(hit: GlobalSearchHitDto): string {
  if (hit.kind === 'wildcard-content') {
    return `${hit.kind}:${hit.relativePath}:${hit.line}`;
  }
  if (hit.kind === 'prompt-content') {
    return `${hit.kind}:${hit.relativePath}:${hit.line}`;
  }
  if (hit.kind === 'prompt-name' || hit.kind === 'wildcard-name') {
    return `${hit.kind}:${hit.relativePath}`;
  }
  return `${hit.kind}:${hit.absolutePath}`;
}

function ScopeToggles({
  scopes,
  onChange,
}: {
  scopes: GlobalSearchScopesDto;
  onChange: (scopes: GlobalSearchScopesDto) => void;
}) {
  return (
    <div className="global-search-scopes" role="group" aria-label="Search in">
      {(
        [
          ['wildcards', 'Wildcards'],
          ['prompts', 'Prompts'],
          ['loras', 'LoRAs'],
          ['checkpoints', 'Checkpoints'],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="global-search-scope">
          <input
            type="checkbox"
            checked={scopes[key]}
            onChange={(e) =>
              onChange({ ...scopes, [key]: e.target.checked })
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function GlobalSearchLauncherModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial: GlobalSearchState;
  onClose: () => void;
  onSubmit: (next: GlobalSearchState) => void;
}) {
  const [query, setQuery] = useState(initial.query);
  const [scopes, setScopes] = useState(initial.scopes);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canSearch =
    query.trim().length > 0 &&
    (scopes.wildcards ||
      scopes.prompts ||
      scopes.loras ||
      scopes.checkpoints);

  const submit = () => {
    if (!canSearch) return;
    onSubmit({ query: query.trim(), scopes });
  };

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Search library"
      >
        <header className="modal-head">
          <h2>
            <Search size={18} /> Search
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">
          <p className="hint">
            Find wildcard files (by name or text), LoRAs, and checkpoints. Results
            open in the Search tab.
          </p>
          <label className="search-box lora-search-box">
            <Search size={14} />
            <input
              ref={inputRef}
              type="search"
              placeholder="e.g. oil painter, detail_slider, krea…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <ScopeToggles scopes={scopes} onChange={setScopes} />
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSearch}
            onClick={submit}
          >
            Search
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SearchWorkspace({
  active = true,
  query,
  scopes,
  refreshNonce = 0,
  onQueryChange,
  onScopesChange,
  onOpenHit,
}: SearchWorkspaceProps) {
  const [hits, setHits] = useState<GlobalSearchHitDto[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGen = useRef(0);
  const [libraryRevision, setLibraryRevision] = useState(0);

  useEffect(() => {
    const bump = () => setLibraryRevision((n) => n + 1);
    const unsubMutated = window.wcm.library.onMutated(() => bump());
    const unsubWatch = window.wcm.watch.onChanged(() => bump());
    return () => {
      unsubMutated();
      unsubWatch();
    };
  }, []);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const trimmed = query.trim();
    const anyScope =
      scopes.wildcards ||
      scopes.prompts ||
      scopes.loras ||
      scopes.checkpoints;
    if (!trimmed || !anyScope) {
      searchGen.current += 1;
      setHits([]);
      setWarnings([]);
      setErr(null);
      setBusy(false);
      return;
    }

    const gen = ++searchGen.current;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void window.wcm.ui
        .searchLibrary(trimmed, scopes)
        .then((result) => {
          if (gen !== searchGen.current) return;
          setHits(result.hits);
          setWarnings(result.warnings);
          setErr(null);
        })
        .catch((e) => {
          if (gen !== searchGen.current) return;
          setHits([]);
          setWarnings([]);
          setErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (gen === searchGen.current) setBusy(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query, scopes, libraryRevision, refreshNonce]);

  const groups = useMemo(() => {
    const wildcardName = hits.filter(
      (h): h is Extract<GlobalSearchHitDto, { kind: 'wildcard-name' }> =>
        h.kind === 'wildcard-name',
    );
    const wildcardContent = hits.filter(
      (h): h is Extract<GlobalSearchHitDto, { kind: 'wildcard-content' }> =>
        h.kind === 'wildcard-content',
    );
    const prompts = hits.filter(
      (h): h is Extract<
        GlobalSearchHitDto,
        { kind: 'prompt-name' | 'prompt-content' }
      > => h.kind === 'prompt-name' || h.kind === 'prompt-content',
    );
    const loras = hits.filter(
      (h): h is Extract<GlobalSearchHitDto, { kind: 'lora' }> =>
        h.kind === 'lora',
    );
    const checkpoints = hits.filter(
      (h): h is Extract<GlobalSearchHitDto, { kind: 'checkpoint' }> =>
        h.kind === 'checkpoint',
    );
    return { wildcardName, wildcardContent, prompts, loras, checkpoints };
  }, [hits]);

  const anyScope =
    scopes.wildcards || scopes.prompts || scopes.loras || scopes.checkpoints;
  const trimmed = query.trim();

  return (
    <div
      className={`workspace search-workspace${active ? '' : ' workspace-tab-hidden'}`}
      aria-hidden={!active}
    >
      <div className="search-workspace-panel">
        <header className="search-workspace-head">
          <h2>
            <Search size={18} /> Search
          </h2>
          <p className="hint">
            Case-insensitive substring match across wildcards, prompt
            !gen.txt files, LoRA models, and checkpoints.
          </p>
        </header>

        <label className="search-box lora-search-box">
          <Search size={14} />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search wildcards, prompts, LoRAs, checkpoints…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </label>

        <ScopeToggles scopes={scopes} onChange={onScopesChange} />

        {busy ? <p className="hint">Searching…</p> : null}
        {err ? <p className="error-inline">{err}</p> : null}
        {warnings.length > 0 ? (
          <ul className="search-workspace-warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        {!trimmed ? (
          <p className="hint">Enter a query to search the active library.</p>
        ) : !anyScope ? (
          <p className="hint">Turn on at least one search scope.</p>
        ) : !busy && !err && hits.length === 0 ? (
          <p className="hint">No matches.</p>
        ) : null}

        {groups.wildcardName.length > 0 ? (
          <ResultSection
            title="Wildcard files"
            icon={<FileText size={16} />}
            count={groups.wildcardName.length}
          >
            {groups.wildcardName.map((hit) => (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  className="search-hit-btn"
                  onClick={() => onOpenHit(hit)}
                >
                  <strong>{hit.name}</strong>
                  <small>{hit.relativePath}</small>
                </button>
              </li>
            ))}
          </ResultSection>
        ) : null}

        {groups.wildcardContent.length > 0 ? (
          <ResultSection
            title="Wildcard content"
            icon={<FileText size={16} />}
            count={groups.wildcardContent.length}
          >
            {groups.wildcardContent.map((hit) => (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  className="search-hit-btn"
                  onClick={() => onOpenHit(hit)}
                >
                  <strong>
                    {hit.relativePath}
                    <span className="lora-search-exact">L{hit.line}</span>
                  </strong>
                  <small className="search-hit-snippet">{hit.snippet}</small>
                </button>
              </li>
            ))}
          </ResultSection>
        ) : null}

        {groups.prompts.length > 0 ? (
          <ResultSection
            title="Prompts (!gen.txt)"
            icon={<FileText size={16} />}
            count={groups.prompts.length}
          >
            {groups.prompts.map((hit) => (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  className="search-hit-btn"
                  onClick={() => onOpenHit(hit)}
                >
                  <strong>
                    {hit.relativePath}
                    {hit.kind === 'prompt-content' ? (
                      <span className="lora-search-exact">L{hit.line}</span>
                    ) : null}
                  </strong>
                  <small className="search-hit-snippet">
                    {hit.kind === 'prompt-content' ? hit.snippet : 'folder'}
                  </small>
                </button>
              </li>
            ))}
          </ResultSection>
        ) : null}

        {groups.loras.length > 0 ? (
          <ResultSection
            title="LoRAs"
            icon={<Layers size={16} />}
            count={groups.loras.length}
          >
            {groups.loras.map((hit) => (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  className="search-hit-btn"
                  onClick={() => onOpenHit(hit)}
                >
                  <strong>
                    {hit.stem}
                    {hit.exact ? (
                      <span className="lora-search-exact">exact</span>
                    ) : null}
                  </strong>
                  <small>{hit.relativePath}</small>
                </button>
              </li>
            ))}
          </ResultSection>
        ) : null}

        {groups.checkpoints.length > 0 ? (
          <ResultSection
            title="Checkpoints"
            icon={<HardDrive size={16} />}
            count={groups.checkpoints.length}
          >
            {groups.checkpoints.map((hit) => (
              <li key={hitKey(hit)}>
                <button
                  type="button"
                  className="search-hit-btn"
                  onClick={() => onOpenHit(hit)}
                >
                  <strong>
                    {hit.stem}
                    {hit.exact ? (
                      <span className="lora-search-exact">exact</span>
                    ) : null}
                  </strong>
                  <small>{hit.relativePath}</small>
                </button>
              </li>
            ))}
          </ResultSection>
        ) : null}
      </div>
    </div>
  );
}

function ResultSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="search-result-section">
      <h3>
        {icon}
        {title}
        <span className="search-result-count">{count}</span>
      </h3>
      <ul className="lora-search-results search-workspace-results">{children}</ul>
    </section>
  );
}

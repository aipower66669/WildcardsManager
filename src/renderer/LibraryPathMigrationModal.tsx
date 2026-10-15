import { useEffect, useState } from 'react';
import { FolderInput, X } from 'lucide-react';
import { modalOverlayDismiss } from './modalOverlayDismiss';
import type {
  LibraryPathFolderFieldDto,
  LibraryPathMigrationApplyResultDto,
  LibraryPathMigrationPlanDto,
} from '../shared/contracts';

type Props = {
  libraryId: string;
  libraryName: string;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
};

export function LibraryPathMigrationModal({
  libraryId,
  libraryName,
  onClose,
  onApplied,
}: Props) {
  const [oldPrefix, setOldPrefix] = useState<string | null>(null);
  const [oldPrefixLoading, setOldPrefixLoading] = useState(true);
  const [newPrefix, setNewPrefix] = useState('');
  const [overrides, setOverrides] = useState<
    Partial<Record<LibraryPathFolderFieldDto, string>>
  >({});
  const [plan, setPlan] = useState<LibraryPathMigrationPlanDto | null>(null);
  const [result, setResult] =
    useState<LibraryPathMigrationApplyResultDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOldPrefixLoading(true);
    void window.wcm.library
      .suggestPathMigrationPrefix(libraryId)
      .then((prefix) => {
        if (cancelled) return;
        setOldPrefix(prefix?.trim() ? prefix : null);
      })
      .catch((e) => {
        if (cancelled) return;
        setOldPrefix(null);
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setOldPrefixLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryId]);

  const runPreview = () =>
    void (async () => {
      setBusy(true);
      setErr(null);
      setResult(null);
      try {
        const folderOverrides: Partial<
          Record<LibraryPathFolderFieldDto, string | null>
        > = {};
        for (const [field, value] of Object.entries(overrides)) {
          if (value?.trim()) {
            folderOverrides[field as LibraryPathFolderFieldDto] = value.trim();
          }
        }
        if (!oldPrefix?.trim()) {
          throw new Error('Could not determine the current path prefix.');
        }
        const next = await window.wcm.library.planPathMigration({
          libraryId,
          oldPrefix,
          newPrefix,
          folderOverrides:
            Object.keys(folderOverrides).length > 0
              ? folderOverrides
              : undefined,
        });
        setPlan(next);
      } catch (e) {
        setPlan(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();

  const pickNewPrefix = () =>
    void (async () => {
      const picked = await window.wcm.library.pickPathMigrationPrefix();
      if (!picked) return;
      setNewPrefix(picked);
      setPlan(null);
    })();

  const pickOverride = (field: LibraryPathFolderFieldDto) =>
    void (async () => {
      const picked = await window.wcm.library.pickPathMigrationPrefix();
      if (!picked) return;
      setOverrides((prev) => ({ ...prev, [field]: picked }));
      setPlan(null);
    })();

  const apply = () =>
    void (async () => {
      if (!plan?.canApply) return;
      const ok = window.confirm(
        `Rewrite paths for library “${libraryName}”?\n\nThis updates AppData pointers and absolute-path sidecars. Model files must already be at the new locations.`,
      );
      if (!ok) return;
      setBusy(true);
      setErr(null);
      try {
        const folderOverrides: Partial<
          Record<LibraryPathFolderFieldDto, string | null>
        > = {};
        for (const [field, value] of Object.entries(overrides)) {
          if (value?.trim()) {
            folderOverrides[field as LibraryPathFolderFieldDto] = value.trim();
          }
        }
        if (!oldPrefix?.trim()) {
          throw new Error('Could not determine the current path prefix.');
        }
        const applied = await window.wcm.library.applyPathMigration({
          libraryId,
          oldPrefix,
          newPrefix,
          folderOverrides:
            Object.keys(folderOverrides).length > 0
              ? folderOverrides
              : undefined,
        });
        setResult(applied);
        await onApplied();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();

  return (
    <div className="modal-overlay" {...modalOverlayDismiss(onClose)}>
      <div
        className="modal library-path-migrate-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>
            <FolderInput size={17} /> Migrate library paths
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body library-path-migrate-body">
          <p className="hint">
            Copy or move the tree first (including sibling <code>*.wcm</code>,
            in-tree <code>!.wcm</code>, and <code>!Thumbnails</code>). Remap
            uses the folder paths already set on{' '}
            <strong>{libraryName}</strong>. Folders on another drive stay put
            unless you Override them after Preview. This does not copy model
            files.
          </p>

          <div className="field-label">Current path prefix</div>
          <p
            className="mono-path library-path-migrate-old"
            title={oldPrefix ?? undefined}
          >
            {oldPrefixLoading
              ? 'Reading library folders…'
              : (oldPrefix ??
                'This library has no folder paths set yet.')}
          </p>

          <label className="field-label" htmlFor="migrate-new-prefix">
            New path prefix
          </label>
          <div className="civitai-category-row">
            <input
              id="migrate-new-prefix"
              className="text-input mono"
              value={newPrefix}
              disabled={busy || !oldPrefix}
              spellCheck={false}
              placeholder="e.g. E:\AI\ComfyUI"
              onChange={(e) => {
                setNewPrefix(e.target.value);
                setPlan(null);
              }}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !oldPrefix}
              onClick={pickNewPrefix}
            >
              …
            </button>
          </div>

          <div className="row-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                oldPrefixLoading ||
                !oldPrefix?.trim() ||
                !newPrefix.trim()
              }
              onClick={runPreview}
            >
              Preview changes
            </button>
          </div>

          {plan ? (
            <>
              <h3 className="library-path-migrate-section">Folder pointers</h3>
              <table className="library-path-migrate-table">
                <thead>
                  <tr>
                    <th>Folder</th>
                    <th>Old</th>
                    <th>New</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.folders.map((row) => (
                    <tr
                      key={row.field}
                      className={row.changed ? 'changed' : undefined}
                    >
                      <td>{row.label}</td>
                      <td className="mono">{row.oldPath ?? '—'}</td>
                      <td className="mono">{row.newPath ?? '—'}</td>
                      <td>
                        {!row.oldPath
                          ? 'unset'
                          : row.changed
                            ? row.newExists
                              ? 'ok'
                              : 'missing'
                            : row.underPrefix
                              ? 'unchanged'
                              : 'outside prefix'}
                        {row.note ? (
                          <div className="hint">{row.note}</div>
                        ) : null}
                      </td>
                      <td>
                        {row.oldPath && (!row.underPrefix || row.override) ? (
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={busy}
                            title="Pick override path for this folder"
                            onClick={() => pickOverride(row.field)}
                          >
                            Override…
                          </button>
                        ) : row.oldPath && row.changed ? (
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={busy}
                            title="Pick a different target for this folder"
                            onClick={() => pickOverride(row.field)}
                          >
                            Override…
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="library-path-migrate-section">Sidecars</h3>
              <ul className="library-path-migrate-sidecar">
                <li>
                  master-images.json:{' '}
                  {plan.sidecar.masterImagesExists
                    ? `~${plan.sidecar.masterImagesRemapEstimate} entries to rewrite`
                    : 'not present'}
                </li>
                <li>
                  series-datasets.json:{' '}
                  {plan.sidecar.seriesDatasetsExists
                    ? plan.sidecar.seriesDatasetsWouldRemap
                      ? 'training root will remap'
                      : 'no training-root remap needed'
                    : 'not present'}
                </li>
                <li>
                  recent roots: {plan.sidecar.recentRootsRemapEstimate} to remap
                </li>
                <li>
                  wildcards sidecar:{' '}
                  {plan.sidecar.wildcardsSidecarExists
                    ? 'found at new location'
                    : plan.sidecar.wildcardsSidecarPath
                      ? 'missing at new location'
                      : 'n/a'}
                </li>
                {plan.sidecar.driveRootSidecarRename?.needed ? (
                  <li>
                    AppData drive-root sidecar:{' '}
                    {plan.sidecar.driveRootSidecarRename.fromExists
                      ? plan.sidecar.driveRootSidecarRename.toExists
                        ? 'destination exists (will not overwrite)'
                        : 'will rename to new id'
                      : 'old id not found'}
                  </li>
                ) : null}
              </ul>

              {plan.blockingErrors.length > 0 ? (
                <ul className="library-path-migrate-errors">
                  {plan.blockingErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              ) : null}
              {plan.warnings.length > 0 ? (
                <ul className="library-path-migrate-warnings">
                  {plan.warnings.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          {result ? (
            <div className="library-path-migrate-result">
              <p>
                Applied: {result.foldersChanged} folder pointer
                {result.foldersChanged === 1 ? '' : 's'},{' '}
                {result.masterImagesRemapped} master-image entr
                {result.masterImagesRemapped === 1 ? 'y' : 'ies'}, series cache{' '}
                {result.seriesDatasetsRemapped ? 'updated' : 'unchanged'},{' '}
                {result.recentRootsRemapped} recent root
                {result.recentRootsRemapped === 1 ? '' : 's'}
                {result.driveRootSidecarMoved
                  ? ', drive-root sidecar moved'
                  : ''}
                .
              </p>
              {result.backupPath ? (
                <p className="hint mono">Settings backup: {result.backupPath}</p>
              ) : null}
            </div>
          ) : null}

          {err ? <p className="error-inline">{err}</p> : null}
        </div>
        <footer className="modal-foot">
          <button type="button" onClick={onClose} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result ? (
            <button
              type="button"
              className="primary"
              disabled={busy || !plan?.canApply}
              onClick={apply}
            >
              Apply remap
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

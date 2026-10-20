import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { X } from 'lucide-react';
import { modalOverlayDismiss } from './modalOverlayDismiss.js';

marked.setOptions({ gfm: true, breaks: false });

function plainIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i,
    '',
  );
}

function releaseNotesHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false });
  const html = typeof raw === 'string' ? raw : '';
  return DOMPurify.sanitize(html);
}

export function ReleaseNotesModal({
  version,
  onClose,
}: {
  version: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(`What's new in ${version}`);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setTitle(`What's new in ${version}`);
    setHtml(null);
    setError(null);
    setHtmlUrl(null);
    void window.wcm.ui
      .getAppReleaseNotes(version)
      .then((notes) => {
        if (cancel) return;
        setTitle(notes.title.trim() || `What's new in ${version}`);
        setHtml(releaseNotesHtml(notes.markdown));
        setHtmlUrl(notes.htmlUrl);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setError(plainIpcError(err));
      });
    return () => {
      cancel = true;
    };
  }, [version]);

  const openLink = (href: string) => {
    if (!/^https?:\/\//i.test(href)) return;
    window.open(href);
  };

  return (
    <div
      className="modal-overlay release-notes-overlay"
      {...modalOverlayDismiss(onClose)}
    >
      <div
        className="modal modal-wide release-notes-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="modal-body release-notes-body">
          {error ? (
            <p className="error-inline">{error}</p>
          ) : html === null ? (
            <p className="hint">Loading release notes…</p>
          ) : (
            <div
              className="release-notes-md"
              onClick={(event) => {
                const anchor = (event.target as HTMLElement | null)?.closest('a');
                if (!anchor) return;
                const href = anchor.getAttribute('href');
                if (!href) return;
                event.preventDefault();
                openLink(href);
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        <footer className="modal-foot release-notes-foot">
          {htmlUrl ? (
            <button type="button" onClick={() => openLink(htmlUrl)}>
              Open on GitHub
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

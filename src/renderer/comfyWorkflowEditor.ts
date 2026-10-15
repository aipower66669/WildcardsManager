/**
 * Load / capture helpers for the Generation Edit Workflow webview.
 * Mirrors LoraTraining: always force-load the saved UI graph so ComfyUI’s
 * session-cached graph cannot masquerade as the app’s saved profile.
 */

/** Minimal empty LiteGraph UI workflow when no profile exists yet. */
export const EMPTY_UI_WORKFLOW = {
  nodes: [],
  links: [],
  groups: [],
  config: {},
  extra: {},
  version: 0.4,
};

/**
 * Load a saved UI-format workflow (preferred) or API-format graph into the
 * ComfyUI editor. Polls briefly for `window.app` after navigation/reload.
 */
export async function loadWorkflowIntoComfyEditor(
  wv: Electron.WebviewTag,
  opts: { uiWorkflow?: unknown; apiWorkflow?: unknown },
): Promise<boolean> {
  const ui =
    opts.uiWorkflow && typeof opts.uiWorkflow === 'object'
      ? opts.uiWorkflow
      : null;
  const api =
    !ui && opts.apiWorkflow && typeof opts.apiWorkflow === 'object'
      ? opts.apiWorkflow
      : null;
  const empty = EMPTY_UI_WORKFLOW;

  return wv.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 50; i++) {
        if (window.app && (window.app.loadGraphData || window.app.loadApiJson)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!window.app) return false;
      const ui = ${JSON.stringify(ui)};
      const api = ${JSON.stringify(api)};
      const empty = ${JSON.stringify(empty)};
      try {
        if (ui && window.app.loadGraphData) {
          await window.app.loadGraphData(ui, true, true);
          return true;
        }
        if (api && typeof window.app.loadApiJson === 'function') {
          window.app.loadApiJson(api, 'wildcards-manager');
          return true;
        }
        if (window.app.loadGraphData) {
          await window.app.loadGraphData(empty, true, true);
          return true;
        }
      } catch (e) {
        console.error('[WCM] loadWorkflowIntoComfyEditor failed', e);
        return false;
      }
      return false;
    })()
  `);
}

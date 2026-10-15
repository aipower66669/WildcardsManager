import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CivitaiFocusModelDto } from '../shared/contracts';
import { App } from './App';
import { CivitaiBrowserModal } from './CivitaiBrowserModal';
import { HuggingFaceBrowserModal } from './HuggingFaceBrowserModal';
import './styles.css';

function CivitaiWindowApp() {
  const [focusModel, setFocusModel] = useState<CivitaiFocusModelDto | null>(
    null,
  );

  useEffect(() => {
    document.title = 'Civitai browser — Wildcards Manager';
  }, []);

  useEffect(() => {
    return window.wcm.civitai.onFocusModel((model) => {
      setFocusModel(model);
    });
  }, []);

  return (
    <div className="civitai-window-app">
      <CivitaiBrowserModal
        presentation="window"
        focusModel={focusModel}
        onFocusModelConsumed={() => setFocusModel(null)}
        onClose={() => void window.wcm.civitai.closeBrowser()}
        onAttach={() => void window.wcm.civitai.attachBrowser()}
        onNotice={() => {
          // Status is shown in the Civitai bottom status bar.
        }}
        onError={() => {
          // Status is shown in the Civitai bottom status bar.
        }}
      />
    </div>
  );
}

function HuggingFaceWindowApp() {
  useEffect(() => {
    document.title = 'Hugging Face — Wildcards Manager';
  }, []);

  return (
    <div className="hf-window-app">
      <HuggingFaceBrowserModal
        presentation="window"
        onClose={() => void window.wcm.huggingface.closeBrowser()}
        onError={() => {
          // Status shown in the HF window body.
        }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

const hash = window.location.hash;
const isCivitaiWindow = hash === '#civitai' || hash === '#/civitai';
const isHfWindow =
  hash === '#huggingface' ||
  hash === '#/huggingface' ||
  hash === '#hf' ||
  hash === '#/hf';

createRoot(root).render(
  <StrictMode>
    {isCivitaiWindow ? (
      <CivitaiWindowApp />
    ) : isHfWindow ? (
      <HuggingFaceWindowApp />
    ) : (
      <App />
    )}
  </StrictMode>,
);

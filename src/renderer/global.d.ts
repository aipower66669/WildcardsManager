import type { WcmDesktopApi } from '../shared/contracts';

declare global {
  interface Window {
    wcm: WcmDesktopApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          allowpopups?: string | boolean;
          partition?: string;
          webpreferences?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};

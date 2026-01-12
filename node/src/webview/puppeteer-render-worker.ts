/**
 * Puppeteer Render Worker (Browser)
 *
 * Runs inside a Puppeteer-controlled Chromium page.
 * Reuses the same render-worker-core + renderers used by VSCode/mobile iframe worker,
 * but exposes a simple global function for the Node-side Node to call via page.evaluate().
 */

import { handleRender, initRenderEnvironment } from '../../../src/renderers/render-worker-core';
import { DirectFetchService, initServices } from '../../../src/renderers/worker/services';
import type { RendererThemeConfig, RenderResult } from '../../../src/types/index';

declare global {
  interface Window {
    __md2docxRenderReady?: boolean;
    __md2docxSetBaseHref?: (href: string) => void;
    __md2docxRender?: (
      renderType: string,
      input: string | object,
      themeConfig?: RendererThemeConfig | null
    ) => Promise<RenderResult>;
  }
}

function ensureBaseTag(): HTMLBaseElement {
  let base = document.querySelector('base');
  if (!base) {
    base = document.createElement('base');
    document.head.appendChild(base);
  }
  return base as HTMLBaseElement;
}

function init(): void {
  // Services used by some renderers (e.g. HtmlRenderer remote images)
  initServices({
    fetch: new DirectFetchService(),
  });

  const canvas = document.getElementById('png-canvas') as HTMLCanvasElement | null;
  initRenderEnvironment({ canvas: canvas ?? undefined });

  window.__md2docxSetBaseHref = (href: string) => {
    const base = ensureBaseTag();
    base.href = href;
  };

  window.__md2docxRender = async (
    renderType: string,
    input: string | object,
    themeConfig: RendererThemeConfig | null = null
  ): Promise<RenderResult> => {
    return await handleRender({ renderType, input, themeConfig });
  };

  window.__md2docxRenderReady = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

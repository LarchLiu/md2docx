/**
 * Puppeteer Render Worker (Browser)
 *
 * Runs inside a Puppeteer-controlled Chromium page.
 * Reuses the same render-worker-core + renderers used by VSCode/mobile iframe worker,
 * but exposes a simple global function for the Node-side to call via page.evaluate().
 */

import { handleRender, initRenderEnvironment } from '../../../src/renderers/render-worker-core';
import { DirectFetchService, initServices } from '../../../src/renderers/worker/services';
import { Md2xRenderer } from '../../../src/renderers/md2x-renderer';
import type { RendererThemeConfig, RenderResult } from '../../../src/types/index';

declare global {
  interface Window {
    __md2xRenderReady?: boolean;
    __md2xSetBaseHref?: (href: string) => void;
    __md2xRender?: (
      renderType: string,
      input: string | object,
      themeConfig?: RendererThemeConfig | null
    ) => Promise<RenderResult>;
    __md2xRenderToDom?: (
      input: string | object,
      themeConfig?: RendererThemeConfig | null
    ) => Promise<string>;
    __md2xCleanupDom?: (id: string) => void;
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

  window.__md2xSetBaseHref = (href: string) => {
    const base = ensureBaseTag();
    base.href = href;
  };

  window.__md2xRender = async (
    renderType: string,
    input: string | object,
    themeConfig: RendererThemeConfig | null = null
  ): Promise<RenderResult> => {
    return await handleRender({ renderType, input, themeConfig });
  };

  const domRenderer = new Md2xRenderer();
  const mounts = new Map<string, () => void>();

  const createId = (): string => `md2x-dom-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  window.__md2xRenderToDom = async (
    input: string | object,
    themeConfig: RendererThemeConfig | null = null
  ): Promise<string> => {
    const id = createId();

    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'position: absolute; left: 0; top: 0; display: inline-block; background: transparent; padding: 0; margin: 0;';
    document.body.appendChild(host);

    try {
      const mounted = await domRenderer.mountToDom(input as any, themeConfig, host);

      // Best-effort: wait a couple of frames + fonts so layout settles before Puppeteer screenshots.
      try {
        if (typeof globalThis.requestAnimationFrame === 'function') {
          await new Promise<void>((r) => globalThis.requestAnimationFrame(() => r()));
          await new Promise<void>((r) => globalThis.requestAnimationFrame(() => r()));
        }
      } catch {}
      try {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }
      } catch {}

      mounts.set(id, () => {
        try { mounted.cleanup(); } catch {}
        try { host.remove(); } catch {}
      });
      return id;
    } catch (e) {
      try { host.remove(); } catch {}
      throw e;
    }
  };

  window.__md2xCleanupDom = (id: string): void => {
    const fn = mounts.get(id);
    if (fn) {
      mounts.delete(id);
      try { fn(); } catch {}
    }
  };

  window.__md2xRenderReady = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

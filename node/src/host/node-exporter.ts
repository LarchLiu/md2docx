/**
 * Node DOCX Exporter
 *
 * Thin Node.js wrapper around the shared `src/exporters/docx-exporter.ts`.
 * The Node provides:
 * - A minimal Node PlatformAPI (resource/storage/file/document)
 * - A Puppeteer-backed PluginRenderer for diagrams/HTML/SVG
 *
 * This keeps the Node behavior aligned with the VSCode extension implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import DocxExporter from '../../../src/exporters/docx-exporter';
import { createBrowserRenderer, type BrowserRenderer } from './browser-renderer';
import { createNodePlatform } from './node-platform';
import type { PluginRenderer, RendererThemeConfig } from '../../../src/types/index';

export type Md2DocxOptions = {
  theme?: string;
  basePath?: string;
};

function ensureBase64Globals(): void {
  // Node 18+ usually has atob/btoa, but keep a safe fallback.
  if (typeof globalThis.atob !== 'function') {
    (globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
  }
  if (typeof globalThis.btoa !== 'function') {
    (globalThis as any).btoa = (bin: string) => Buffer.from(bin, 'binary').toString('base64');
  }
}

async function loadRendererThemeConfig(themeId: string): Promise<RendererThemeConfig> {
  const platform = globalThis.platform as any;
  const text = await platform.resource.fetch(`themes/presets/${themeId}.json`);
  const theme = JSON.parse(text) as any;
  const fontFamily = theme?.fontScheme?.body?.fontFamily;
  const fontSize = theme?.fontScheme?.body?.fontSize ? parseFloat(theme.fontScheme.body.fontSize) : undefined;

  return {
    fontFamily: typeof fontFamily === 'string' ? fontFamily : undefined,
    fontSize: typeof fontSize === 'number' && Number.isFinite(fontSize) ? fontSize : undefined,
  };
}

function createPluginRenderer(
  browserRenderer: BrowserRenderer | null,
  basePath: string,
  themeConfig: RendererThemeConfig
): PluginRenderer | null {
  if (!browserRenderer) {
    return null;
  }

  return {
    async render(type: string, content: string | object) {
      const result = await browserRenderer.render(type, content, basePath, themeConfig);
      if (!result) return null;
      return result;
    },
  };
}

/**
 * Node DOCX Exporter Class (public API used by node/src/host/index.ts)
 */
export class NodeDocxExporter {
  /**
   * Export markdown to DOCX buffer
   */
  async exportToBuffer(markdown: string, options: Md2DocxOptions = {}): Promise<Buffer> {
    ensureBase64Globals();

    const themeId = options.theme || 'default';
    const basePath = options.basePath || process.cwd();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    const { platform, getCapturedBuffer } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    // Ensure DocumentService resolves relative images from the intended basePath.
    const virtualDocPath = path.join(basePath, '__md2docx__.md');

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (browserRenderer) {
        await browserRenderer.initialize();
      }

      const themeConfig = await loadRendererThemeConfig(themeId);
      const pluginRenderer = createPluginRenderer(browserRenderer, basePath, themeConfig);

      const exporter = new DocxExporter(pluginRenderer);
      exporter.setBaseUrl?.(pathToFileURL(virtualDocPath).href);

      const result = await exporter.exportToDocx(markdown, '__md2docx__.docx', null);
      if (!result.success) {
        throw new Error(result.error || 'DOCX export failed');
      }

      const buffer = getCapturedBuffer();
      if (!buffer) {
        throw new Error('DOCX export produced no output buffer');
      }
      return buffer;
    } finally {
      try {
        if (browserRenderer) {
          await browserRenderer.close();
        }
      } finally {
        (globalThis as any).platform = previousPlatform;
      }
    }
  }

  /**
   * Export markdown file to DOCX file
   */
  async exportToFile(inputPath: string, outputPath: string, options: Md2DocxOptions = {}): Promise<void> {
    ensureBase64Globals();

    const markdown = fs.readFileSync(inputPath, 'utf-8');
    const basePath = path.dirname(path.resolve(inputPath));
    const themeId = options.theme || 'default';
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    const { platform } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'file' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (browserRenderer) {
        await browserRenderer.initialize();
      }

      const themeConfig = await loadRendererThemeConfig(themeId);
      const pluginRenderer = createPluginRenderer(browserRenderer, basePath, themeConfig);

      const exporter = new DocxExporter(pluginRenderer);
      exporter.setBaseUrl?.(pathToFileURL(path.resolve(inputPath)).href);

      const result = await exporter.exportToDocx(markdown, path.resolve(outputPath), null);
      if (!result.success) {
        throw new Error(result.error || 'DOCX export failed');
      }
    } finally {
      try {
        if (browserRenderer) {
          await browserRenderer.close();
        }
      } finally {
        (globalThis as any).platform = previousPlatform;
      }
    }
  }
}

export default NodeDocxExporter;

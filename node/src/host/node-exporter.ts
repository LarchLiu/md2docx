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
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { createBrowserRenderer } from './browser-renderer';
import { createNodePlatform } from './node-platform';
import { plugins } from '../../../src/plugins/index';
import type { PluginRenderer } from '../../../src/types/index';
import {
  markdownToHtml,
  buildLiveDiagramBootstrapCdn,
  liveRuntimeChunks,
  loadBaseCss,
  loadThemeCss,
  loadRendererThemeConfig,
  collectMd2xTemplateFilesFromMarkdown,
} from './core';
import type {
  RendererThemeConfig,
  BrowserRenderer,
  Md2xTemplateConfig,
  Md2xBaseOptions,
  Md2DocxOptions,
  Md2PdfOptions,
  Md2ImageOptions,
  Md2HtmlOptions,
} from './types';

// Helper to get module directory - uses global set by entry point, or falls back to import.meta.url
function getModuleDir(): string {
  if ((globalThis as any).__md2x_module_dir__) {
    return (globalThis as any).__md2x_module_dir__;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

function ensureBase64Globals(): void {
  // Node 18+ usually has atob/btoa, but keep a safe fallback.
  if (typeof globalThis.atob !== 'function') {
    (globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
  }
  if (typeof globalThis.btoa !== 'function') {
    (globalThis as any).btoa = (bin: string) => Buffer.from(bin, 'binary').toString('base64');
  }
}

function createPluginRenderer(
  browserRenderer: BrowserRenderer | null,
  basePath: string,
  themeConfig: RendererThemeConfig,
  md2xTemplateFiles?: Record<string, string>,
  cdnOverrides?: Md2HtmlOptions['cdn']
): PluginRenderer | null {
  if (!browserRenderer) {
    return null;
  }

  return {
    async render(type: string, content: string | object) {
      const renderInput =
        type === 'md2x' && typeof content === 'string'
          ? ({
              code: content,
              templateFiles: md2xTemplateFiles ?? {},
              cdn: {
                vue: cdnOverrides?.vue,
                vueSfcLoader: cdnOverrides?.vueSfcLoader,
                svelteCompiler: cdnOverrides?.svelteCompiler,
                svelteBase: cdnOverrides?.svelteBase,
              },
            } as any)
          : content;

      const result = await browserRenderer.render(type, renderInput, basePath, themeConfig);
      if (!result) return null;
      return result;
    },
  };
}

function escapeHtmlText(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3C;/gi, '<')
    .replace(/&#x3E;/gi, '>')
    .replace(/&#x26;/gi, '&')
    .replace(/&#60;/g, '<')
    .replace(/&#62;/g, '>')
    .replace(/&#38;/g, '&');
}

async function processDiagrams(
  html: string,
  browserRenderer: BrowserRenderer | null,
  basePath: string,
  themeConfig: RendererThemeConfig,
  mode: 'img' | 'live' | 'none',
  md2xTemplateFiles?: Record<string, string>,
  cdnOverrides?: Md2HtmlOptions['cdn']
): Promise<string> {
  if (mode !== 'img') return html;
  if (!browserRenderer) return html;

  // Build supported languages from plugin system
  // Only include plugins that handle 'code' nodes (not 'html' or 'image' only)
  const pluginLangs = plugins
    .filter(p => p.nodeSelector.includes('code'))
    .map(p => p.language)
    .filter((lang): lang is string => lang !== null);

  // Add common aliases that plugins support via extractContent override
  const aliases = ['graphviz', 'gv', 'vegalite'];
  const supportedLangs = [...pluginLangs, ...aliases].join('|');

  if (!supportedLangs) return html;

  // Match code blocks with diagram languages
  // rehype-highlight adds "hljs" class, so we need to match both formats:
  // - class="language-mermaid" (without highlight)
  // - class="hljs language-mermaid" (with highlight)
  // Note: \\s\\S must be double-escaped in template strings for RegExp constructor
  const codeBlockRegex = new RegExp(
    `<pre><code class="(?:hljs )?language-(${supportedLangs})">([\\s\\S]*?)<\\/code><\\/pre>`,
    'gi'
  );

  const matches = [...html.matchAll(codeBlockRegex)];

  for (const match of matches) {
    const [fullMatch, lang, code] = match;
    // rehype-highlight wraps tokens in <span>. Strip tags before decoding entities to preserve real "<" in code.
    const decodedCode = decodeHtmlEntities(String(code || '').replace(/<[^>]*>/g, ''));

    // Normalize language aliases to renderer types
    let renderType = lang.toLowerCase();
    if (renderType === 'graphviz' || renderType === 'gv') renderType = 'dot';
    if (renderType === 'vegalite') renderType = 'vega-lite';

    try {
      const renderInput =
        renderType === 'md2x'
          ? ({
              code: decodedCode,
              templateFiles: md2xTemplateFiles ?? {},
              cdn: {
                vue: cdnOverrides?.vue,
                vueSfcLoader: cdnOverrides?.vueSfcLoader,
                svelteCompiler: cdnOverrides?.svelteCompiler,
                svelteBase: cdnOverrides?.svelteBase,
              },
            } as any)
          : decodedCode;

      const result = await browserRenderer.render(renderType, renderInput, basePath, themeConfig);
      if (result && result.base64) {
        // Tag the wrapper/img with kind so callers can target specific diagram types via CSS selectors,
        // e.g. `.md2x-diagram[data-md2x-diagram-kind="mermaid"]`.
        const kind = escapeHtmlText(renderType);
        const imgTag = `<div class="md2x-diagram" data-md2x-diagram-kind="${kind}"><img class="md2x-diagram" data-md2x-diagram-kind="${kind}" src="data:image/${result.format};base64,${result.base64}" alt="${escapeHtmlText(
          `${lang} diagram`
        )}" style="max-width: 100%;" /></div>`;
        html = html.replace(fullMatch, imgTag);
      }
    } catch (e) {
      console.warn(`Failed to render ${lang} diagram:`, e);
      // Keep original code block on error
    }
  }

  return html;
}

async function markdownToHtmlFragment(
  markdown: string,
  browserRenderer: BrowserRenderer | null,
  basePath: string,
  themeConfig: RendererThemeConfig,
  diagramMode: 'img' | 'live' | 'none',
  templates?: Record<string, string>,
  cdnOverrides?: Md2HtmlOptions['cdn']
): Promise<string> {
  // Use core markdown-to-html conversion
  let html = await markdownToHtml(markdown);

  const md2xTemplateFiles =
    diagramMode === 'img' ? collectMd2xTemplateFilesFromMarkdown(markdown, templates) : undefined;

  // Process diagrams (mermaid, graphviz, vega-lite, etc.)
  html = await processDiagrams(html, browserRenderer, basePath, themeConfig, diagramMode, md2xTemplateFiles, cdnOverrides);

  return html;
}

const __md2xInlineLiveRuntimeCache = new Map<string, string>();

function loadInlineLiveRuntimeJs(filename: string): string {
  const key = String(filename || '').trim();
  if (!key) throw new Error('Missing live runtime filename');

  const cached = __md2xInlineLiveRuntimeCache.get(key);
  if (typeof cached === 'string') return cached;

  const moduleDir = getModuleDir();
  const candidates = [
    // Published package: node/dist/renderer/<file>
    path.join(moduleDir, 'renderer', key),
    // Dev: node/src/host -> node/dist/renderer/<file>
    path.join(moduleDir, '..', '..', 'dist', 'renderer', key),
    // Fallbacks
    path.join(moduleDir, '..', 'dist', 'renderer', key),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const src = fs.readFileSync(p, 'utf-8');
        __md2xInlineLiveRuntimeCache.set(key, src);
        return src;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    `Missing live renderer runtime: ${key}. ` +
      'Run node node/build.mjs to build node/dist assets.'
  );
}

function detectLiveRenderTypesFromHtml(html: string): string[] {
  const src = String(html || '');
  const types = new Set<string>();
  const re = /\blanguage-([a-z0-9-]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let t = String(m[1] || '').toLowerCase();
    if (t === 'graphviz' || t === 'gv') t = 'dot';
    if (t === 'vegalite') t = 'vega-lite';
    if (t) types.add(t);
  }
  return Array.from(types);
}

function getDefaultLiveRuntimeCdnBaseUrl(): string {
  try {
    const moduleDir = getModuleDir();
    const pkgPath = path.join(moduleDir, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as any;
    const name = typeof pkg?.name === 'string' ? pkg.name : 'md2x';
    const version = typeof pkg?.version === 'string' ? pkg.version : 'latest';
    // Keep scoped package names as path segments (e.g. "@scope/pkg").
    const safeName = encodeURIComponent(name).replace(/%2F/g, '/');
    const safeVersion = encodeURIComponent(version);
    return `https://cdn.jsdelivr.net/npm/${safeName}@${safeVersion}/dist/renderer/`;
  } catch {
    return 'https://cdn.jsdelivr.net/npm/md2x@latest/dist/renderer/';
  }
}

function buildLiveDiagramBootstrap(
  themeConfig: RendererThemeConfig | null,
  baseHref: string,
  cdnOverrides: Md2HtmlOptions['cdn'] | undefined,
  md2xTemplateFiles: Record<string, string> | undefined,
  runtime?: { mode?: 'inline' | 'cdn'; baseUrl?: string },
  requiredRenderTypes?: string[]
): string {
  // Prevent `</script>` inside embedded JSON (e.g., Vue SFC source) from terminating the bootstrap script tag.
  const jsonForInlineScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

  // Mermaid is still loaded as a global for MermaidRenderer.
  const mermaidSrc = (cdnOverrides && (cdnOverrides as any).mermaid)
    ? String((cdnOverrides as any).mermaid)
    : 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

  // Default is inline (compat). HTML export can opt into `liveRuntime: "cdn"` to avoid
  // embedding the full runtime JS into the HTML output.
  const liveRuntimeMode: 'inline' | 'cdn' = runtime?.mode === 'cdn' ? 'cdn' : 'inline';

  const types = Array.isArray(requiredRenderTypes) ? requiredRenderTypes : [];

  if (liveRuntimeMode === 'cdn') {
    const runtimeBaseUrl = runtime?.baseUrl || getDefaultLiveRuntimeCdnBaseUrl();
    return buildLiveDiagramBootstrapCdn(types, {
      runtimeBaseUrl,
      mermaidUrl: mermaidSrc,
      baseHref,
      themeConfig,
      md2xTemplateFiles,
      cdn: cdnOverrides,
    });
  }

  // Inline mode - read local files
  const chunks = liveRuntimeChunks(types);
  const needMermaid = chunks.includes('live-runtime-mermaid.js');

  const optsJson = jsonForInlineScript({
    baseHref: baseHref || '',
    themeConfig: themeConfig ?? null,
    md2xTemplateFiles: md2xTemplateFiles ?? {},
    cdn: cdnOverrides ?? {},
    rootSelector: '#markdown-content',
  });

  const runtimeFiles = ['live-runtime-core.js', ...chunks.sort()];
  const runtimeSources = runtimeFiles.map((f) => ({ file: f, source: loadInlineLiveRuntimeJs(f) }));

  return `
  <!-- md2x live diagram renderer (worker mountToDom) (runtime: inline) -->
  <script>try { window.__md2xLiveDone = false; } catch {}</script>
${needMermaid ? `  <script src="${escapeHtmlText(mermaidSrc)}"></script>\n` : ''}  <script>
  (function () {
    const runtimeFiles = ${jsonForInlineScript(runtimeFiles)};
    const runtimeSources = ${jsonForInlineScript(runtimeSources)};
    for (let i = 0; i < runtimeSources.length; i++) {
      const src = runtimeSources[i] && runtimeSources[i].source ? String(runtimeSources[i].source) : '';
      if (!src) continue;
      const s = document.createElement('script');
      s.textContent = src;
      document.head.appendChild(s);
    }
  })();
  </script>
  <script>
  (function () {
    const opts = ${optsJson};
    const start = Date.now();

    function runWhenReady() {
      const fn = window.__md2xRenderDocument;
      if (typeof fn === 'function') {
        fn(opts).catch(() => { try { window.__md2xLiveDone = true; } catch {} });
        return;
      }
      if (Date.now() - start > 15000) {
        try { window.__md2xLiveDone = true; } catch {}
        return;
      }
      setTimeout(runWhenReady, 25);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runWhenReady, { once: true });
    } else {
      runWhenReady();
    }
  })();
  </script>`;
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
    const basePath = options.basePath ?? process.cwd();
    const moduleDir = getModuleDir();

    const { platform, getCapturedBuffer } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
      settings: {
        docxHrAsPageBreak: options.hrAsPageBreak ?? true,
      },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    // Ensure DocumentService resolves relative images from the intended basePath.
    const virtualDocPath = path.join(basePath, '__md2x__.md');

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (browserRenderer) {
        await browserRenderer.initialize();
      }

      const themeConfig = loadRendererThemeConfig(themeId);
      const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, options.templates);
      const pluginRenderer = createPluginRenderer(browserRenderer, basePath, themeConfig, md2xTemplateFiles);

      // Dynamic import to reduce bundle size - docx is only loaded when needed
      const { default: DocxExporter } = await import('../../../src/exporters/docx-exporter');
      const exporter = new DocxExporter(pluginRenderer);
      exporter.setBaseUrl?.(pathToFileURL(virtualDocPath).href);

      const result = await exporter.exportToDocx(markdown, '__md2x__.docx', null);
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

}

function loadKatexCss(): string {
  // `rehype-katex` outputs KaTeX HTML that requires KaTeX CSS.
  // Without it, the MathML/annotation subtree becomes visible in print/PDF and looks like duplicated "source".
  const moduleDir = getModuleDir();
  const bundledKatexCssPath = path.join(moduleDir, 'vendor', 'katex', 'katex.min.css');

  let katexCssPath = bundledKatexCssPath;
  if (!fs.existsSync(bundledKatexCssPath)) {
    // Dev/monorepo fallback (root dependency).
    const require = createRequire(import.meta.url);
    katexCssPath = require.resolve('katex/dist/katex.min.css');
  }

  const katexDistDir = path.dirname(katexCssPath);
  const katexFontsHref = pathToFileURL(path.join(katexDistDir, 'fonts') + path.sep).href;

  let css = fs.readFileSync(katexCssPath, 'utf-8');
  // KaTeX CSS references fonts via `url(fonts/...)`. When inlined into the PDF HTML, those URLs become relative
  // to the temporary HTML file path, so we rewrite them to absolute file:// URLs.
  css = css.replace(/url\((['"]?)(?:\.\/)?fonts\//g, `url($1${katexFontsHref}`);
  return css;
}

/**
 * Node PDF Exporter Class
 */
export class NodePdfExporter {
  /**
   * Export markdown to PDF buffer
   */
  async exportToBuffer(markdown: string, options: Md2PdfOptions = {}): Promise<Buffer> {
    ensureBase64Globals();

    const themeId = options.theme || 'default';
    const basePath = options.basePath ?? process.cwd();
    const moduleDir = getModuleDir();

    const { platform } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (!browserRenderer) {
        throw new Error('Failed to create browser renderer. Puppeteer is required for PDF export.');
      }
      await browserRenderer.initialize();

      const themeConfig = loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'img';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templates, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, options.templates);
        const requiredTypes = detectLiveRenderTypesFromHtml(html);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles, { mode: 'inline' }, requiredTypes);
      }

      // Load CSS
      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for PDF export:', e);
      }
      const baseCss = loadBaseCss(options.hrAsPageBreak ?? true);
      let themeCss = '';
      try {
        themeCss = loadThemeCss(themeId);
      } catch (e) {
        console.warn('Failed to load theme CSS, using base styles only:', e);
      }
      // Order matters: KaTeX first, then our overrides/base, then theme.
      const css = katexCss + '\n' + baseCss + '\n' + themeCss;

      // Export to PDF
      return await browserRenderer.exportToPdf(html, css, options.pdf, basePath);
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

/**
 * Node Image Exporter Class
 *
 * Renders Markdown -> HTML -> full-page screenshot (PNG/JPEG/WebP).
 */
export class NodeImageExporter {
  async exportToBuffer(markdown: string, options: Md2ImageOptions = {}): Promise<Buffer> {
    ensureBase64Globals();

    const themeId = options.theme || 'default';
    const basePath = options.basePath ?? process.cwd();
    const moduleDir = getModuleDir();

    const { platform } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (!browserRenderer) {
        throw new Error('Failed to create browser renderer. Puppeteer is required for image export.');
      }
      await browserRenderer.initialize();

      const themeConfig = loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'live';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templates, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, options.templates);
        const requiredTypes = detectLiveRenderTypesFromHtml(html);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles, { mode: 'inline' }, requiredTypes);
      }

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for image export:', e);
      }

      const baseCss = loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = loadThemeCss(themeId);
      } catch (e) {
        console.warn('Failed to load theme CSS, using base styles only:', e);
      }

      const css = katexCss + '\n' + baseCss + '\n' + themeCss;

      return await browserRenderer.exportToImage(html, css, options.image, basePath);
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

  async exportToBuffers(markdown: string, options: Md2ImageOptions = {}): Promise<Buffer[]> {
    ensureBase64Globals();

    const themeId = options.theme || 'default';
    const basePath = options.basePath ?? process.cwd();
    const moduleDir = getModuleDir();

    const { platform } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    let browserRenderer: BrowserRenderer | null = null;
    try {
      browserRenderer = await createBrowserRenderer();
      if (!browserRenderer) {
        throw new Error('Failed to create browser renderer. Puppeteer is required for image export.');
      }
      await browserRenderer.initialize();

      const themeConfig = loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'live';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templates, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, options.templates);
        const requiredTypes = detectLiveRenderTypesFromHtml(html);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles, { mode: 'inline' }, requiredTypes);
      }

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for image export:', e);
      }

      const baseCss = loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = loadThemeCss(themeId);
      } catch (e) {
        console.warn('Failed to load theme CSS, using base styles only:', e);
      }

      const css = katexCss + '\n' + baseCss + '\n' + themeCss;

      return await browserRenderer.exportToImageParts(html, css, options.image, basePath);
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

/**
 * Node HTML Exporter Class
 */
export class NodeHtmlExporter {
  /**
   * Export markdown to standalone HTML string (default) or HTML fragment.
   */
  async exportToString(markdown: string, options: Md2HtmlOptions = {}): Promise<string> {
    ensureBase64Globals();

    const themeId = options.theme || 'default';
    const basePath = options.basePath ?? process.cwd();
    const moduleDir = getModuleDir();
    const diagramMode: 'img' | 'live' | 'none' = options.diagramMode || 'live';

    const { platform } = createNodePlatform({
      moduleDir,
      selectedThemeId: themeId,
      output: { kind: 'buffer' },
    });

    const previousPlatform = (globalThis as any).platform;
    (globalThis as any).platform = platform;

    let browserRenderer: BrowserRenderer | null = null;
    try {
      const themeConfig = loadRendererThemeConfig(themeId);

      if (diagramMode === 'img') {
        browserRenderer = await createBrowserRenderer();
        if (browserRenderer) {
          await browserRenderer.initialize();
        }
      }

      const fragment = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templates, options.cdn);

      const standalone = options.standalone !== false;
      if (!standalone) return fragment;

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for HTML export:', e);
      }

      const baseCss = loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = loadThemeCss(themeId);
      } catch (e) {
        console.warn('Failed to load theme CSS for HTML export, using base styles only:', e);
      }

      const css = katexCss + '\n' + baseCss + '\n' + themeCss;

      const title = options.title || 'Document';
      const shouldEmitBase = options.baseTag !== false && !!basePath;
      const baseHref = shouldEmitBase ? pathToFileURL(basePath + path.sep).href : '';
      const baseTag = baseHref ? `  <base href="${escapeHtmlText(baseHref)}" />\n` : '';

      // Reuse the same live bootstrap as image export so HTML and image captures behave consistently.
      const liveBootstrap = diagramMode === 'live'
        ? buildLiveDiagramBootstrap(
          themeConfig ?? null,
          baseHref,
          options.cdn,
          collectMd2xTemplateFilesFromMarkdown(markdown, options.templates),
          { mode: options.liveRuntime ?? 'cdn', baseUrl: options.liveRuntimeBaseUrl },
          detectLiveRenderTypesFromHtml(fragment)
        )
        : '';

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
${baseTag}  <title>${escapeHtmlText(title)}</title>
  <style>${css}</style>
</head>
<body>
  <div id="markdown-content" class="markdown-body">${fragment}</div>
${liveBootstrap}
</body>
</html>`;
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

  async exportToBuffer(markdown: string, options: Md2HtmlOptions = {}): Promise<Buffer> {
    const html = await this.exportToString(markdown, options);
    return Buffer.from(html, 'utf8');
  }
}

export default NodeDocxExporter;

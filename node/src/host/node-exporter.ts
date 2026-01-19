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
import { createBrowserRenderer, type BrowserRenderer, type PdfOptions, type ImageOptions } from './browser-renderer';
import { createNodePlatform } from './node-platform';
import { plugins } from '../../../src/plugins/index';
import type { PluginRenderer, RendererThemeConfig } from '../../../src/types/index';

export interface Md2xTemplateConfig {
  template: string;
  type: 'vue' | 'html' | 'svelte';
  data: any;
}

// Helper to get module directory - uses global set by entry point, or falls back to import.meta.url
function getModuleDir(): string {
  if ((globalThis as any).__md2x_module_dir__) {
    return (globalThis as any).__md2x_module_dir__;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

export type Md2xBaseOptions = {
  theme?: string;
  basePath?: string;
  /**
   * When true, horizontal rules (---, ***, ___) will be converted to page breaks in print/PDF.
   * Note: this hides `<hr>` visually (default: false for HTML).
   */
  hrAsPageBreak?: boolean;
  /**
   * Diagram/template rendering mode for PDF export:
   * - "img": pre-render diagrams before printing (default; offline-friendly)
   * - "live": render in the browser before printing (required for md2x Vue templates)
   * - "none": do not process diagrams/templates
   */
  diagramMode?: 'img' | 'live' | 'none';
  /**
   * Extra directories to search for md2x templates referenced by ` ```md2x ` blocks.
   * Useful when templates live outside the markdown folder.
   *
   * Can be a single path or a list of paths. Relative paths are resolved against `basePath`.
   */
  templatesDir?: string | string[];
};

export type Md2DocxOptions = Md2xBaseOptions;

export type Md2PdfOptions = Md2xBaseOptions & {
  pdf?: PdfOptions;
  /**
   * CDN overrides for live mode.
   * Same shape as HTML export's `cdn` option.
   */
  cdn?: Md2HtmlOptions['cdn'];
};

export type Md2ImageOptions = Md2xBaseOptions & {
  image?: ImageOptions;
  /**
   * CDN overrides for live diagram mode.
   * Same shape as HTML export's `cdn` option.
   */
  cdn?: Md2HtmlOptions['cdn'];
};

export type Md2HtmlOptions = Md2xBaseOptions & {
  /** Document title for standalone HTML output */
  title?: string;
  /** When true, returns a full HTML document with embedded CSS (default: true) */
  standalone?: boolean;
  /**
   * Optional CDN overrides (URLs). Only used when `diagramMode: "live"`.
   */
  cdn?: Partial<{
    mermaid: string;
    /** Graphviz runtime (preferred): @viz-js/viz global build */
    vizGlobal: string;
    /** Legacy Graphviz runtime: viz.js (kept for compatibility) */
    viz: string;
    /** Legacy Graphviz runtime dependency: viz.js full.render.js (kept for compatibility) */
    vizRender: string;
    vega: string;
    vegaLite: string;
    vegaEmbed: string;
    infographic: string;
    /** Vue 3 global build (required for md2x vue templates in live mode) */
    vue: string;
    /** vue3-sfc-loader UMD (required for md2x vue templates in live mode) */
    vueSfcLoader: string;
    /**
     * ESM URL that exports `compile` (e.g. `svelte/compiler` build).
     * Used for md2x Svelte templates in live mode.
     */
    svelteCompiler: string;
    /**
     * Base URL used to resolve runtime module imports (e.g. `svelte/internal`, `svelte/store`).
     * Example: "https://esm.sh/svelte@5/".
     */
    svelteBase: string;
  }>;
  /** When true, emit a `<base href="file://.../">` tag so relative URLs resolve against basePath (default: true) */
  baseTag?: boolean;
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

function collectMd2xTemplateFiles(
  html: string,
  basePath: string,
  templatesDir?: string | string[]
): Record<string, string> {
  // Match md2x code blocks in the HTML fragment.
  // Same considerations as diagrams: rehype-highlight may add "hljs".
  const codeBlockRegex = new RegExp(`<pre><code class="[^"]*\\blanguage-md2x\\b[^"]*">([\\s\\S]*?)<\\/code><\\/pre>`, 'gi');
  const matches = [...html.matchAll(codeBlockRegex)];
  const out: Record<string, string> = {};

  const extractQuoted = (text: string, key: string): string => {
    // Best-effort: `key: 'value'` / `key: "value"` (usually single-line).
    // Note: intentionally does not support template literals to avoid escaping issues and surprises.
    const m = text.match(new RegExp(`\\b${key}\\s*:\\s*(['"])([^\\n\\r]*?)\\1`, 'i'));
    return (m?.[2] ?? '').trim();
  };

  const normalizeMd2xTemplateRef = (type: string, tpl: string): string => {
    const t = String(type || '').trim().toLowerCase();
    const v = String(tpl || '').trim();
    if (!t || !v) return v;
    // If user already provided a path/URL, keep it.
    if (v.includes('/') || v.includes('\\') || v.includes('://') || v.startsWith('file://')) return v;
    return `${t}/${v}`;
  };

  const normalizeTemplateDirs = (): string[] => {
    if (!templatesDir) return [];
    const arr = Array.isArray(templatesDir) ? templatesDir : [templatesDir];
    return arr
      .map((d) => String(d || '').trim())
      .filter(Boolean);
  };

  for (const match of matches) {
    const codeHtml = match[1] ?? '';
    // If highlight spans are present, strip tags to recover the raw text.
    // Important: strip tags BEFORE decoding entities, otherwise real "&lt;...&gt;" in strings would be lost.
    const decodedCode = decodeHtmlEntities(String(codeHtml || '').replace(/<[^>]*>/g, ''));
    const typeRef = extractQuoted(decodedCode, 'type');
    const templateRaw = extractQuoted(decodedCode, 'template');
    const templateRef = normalizeMd2xTemplateRef(typeRef, templateRaw);
    if (!templateRef) continue;

    const resolveExistingFilePath = (ref: string): string | null => {
      try {
        if (String(ref).toLowerCase().startsWith('file://')) {
          const p = fileURLToPath(ref);
          return fs.existsSync(p) ? p : null;
        }
        if (path.isAbsolute(ref)) {
          return fs.existsSync(ref) ? ref : null;
        }

        const moduleDir = getModuleDir();
        const extraDirs = normalizeTemplateDirs().map((d) => {
          try {
            if (String(d).toLowerCase().startsWith('file://')) return fileURLToPath(d);
          } catch {}
          // Relative template dir is resolved against basePath to match user expectations.
          return path.isAbsolute(d) ? d : path.join(basePath, d);
        });

        const extraCandidates: string[] = [];
        for (const dir of extraDirs) {
          extraCandidates.push(path.join(dir, ref));
        }

        const candidates = [
          // User templates usually live next to the markdown document (basePath).
          path.join(basePath, ref),
          // Optional external template dirs (CLI --template-dir).
          ...extraCandidates,
          // Packaged CLI may ship templates next to the module root (node/dist/templates/*).
          path.join(moduleDir, 'templates', ref),
          // Dev/monorepo fallback (this repo layout): node/src/templates/* (moduleDir is node/src/host).
          path.join(moduleDir, '..', 'templates', ref),
          // Another dev fallback when moduleDir is node/dist: node/src/templates/*.
          path.join(moduleDir, '..', 'src', 'templates', ref),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) return p;
        }
        return null;
      } catch {
        return null;
      }
    };

    const filePath = resolveExistingFilePath(templateRef);
    if (!filePath) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const href = pathToFileURL(filePath).href;
      // Prefer absolute file:// keys to avoid browser fetch/CORS restrictions.
      out[href] = content;
      // Also keep the original key as a fallback (for loaders that pass relative paths through).
      out[templateRef] = content;
      // And keep the raw `template:` value too (so old blocks keep working).
      if (templateRaw) out[templateRaw] = content;
    } catch {
      // Skip missing templates; renderer will show a "missing template" message.
    }
  }

  return out;
}

function collectMd2xTemplateFilesFromMarkdown(
  markdown: string,
  basePath: string,
  templatesDir?: string | string[]
): Record<string, string> {
  // Match fenced md2x blocks:
  // ```md2x
  // ...
  // ```
  const fenceRegex = /```md2x[^\n\r]*[\r\n]([\s\S]*?)```/gi;
  const matches = [...String(markdown || '').matchAll(fenceRegex)];
  const out: Record<string, string> = {};

  const extractQuoted = (text: string, key: string): string => {
    const m = text.match(new RegExp(`\\b${key}\\s*:\\s*(['"])([^\\n\\r]*?)\\1`, 'i'));
    return (m?.[2] ?? '').trim();
  };

  const normalizeMd2xTemplateRef = (type: string, tpl: string): string => {
    const t = String(type || '').trim().toLowerCase();
    const v = String(tpl || '').trim();
    if (!t || !v) return v;
    if (v.includes('/') || v.includes('\\') || v.includes('://') || v.startsWith('file://')) return v;
    return `${t}/${v}`;
  };

  const normalizeTemplateDirs = (): string[] => {
    if (!templatesDir) return [];
    const arr = Array.isArray(templatesDir) ? templatesDir : [templatesDir];
    return arr
      .map((d) => String(d || '').trim())
      .filter(Boolean);
  };

  const resolveExistingFilePath = (ref: string): string | null => {
    try {
      if (String(ref).toLowerCase().startsWith('file://')) {
        const p = fileURLToPath(ref);
        return fs.existsSync(p) ? p : null;
      }
      if (path.isAbsolute(ref)) {
        return fs.existsSync(ref) ? ref : null;
      }

      const moduleDir = getModuleDir();
      const extraDirs = normalizeTemplateDirs().map((d) => {
        try {
          if (String(d).toLowerCase().startsWith('file://')) return fileURLToPath(d);
        } catch {}
        return path.isAbsolute(d) ? d : path.join(basePath, d);
      });

      const extraCandidates: string[] = [];
      for (const dir of extraDirs) {
        extraCandidates.push(path.join(dir, ref));
      }

      const candidates = [
        path.join(basePath, ref),
        ...extraCandidates,
        path.join(moduleDir, 'templates', ref),
        path.join(moduleDir, '..', 'templates', ref),
        path.join(moduleDir, '..', 'src', 'templates', ref),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
      return null;
    } catch {
      return null;
    }
  };

  for (const match of matches) {
    const code = String(match[1] ?? '');
    const typeRef = extractQuoted(code, 'type');
    const templateRaw = extractQuoted(code, 'template');
    const templateRef = normalizeMd2xTemplateRef(typeRef, templateRaw);
    if (!templateRef) continue;

    const filePath = resolveExistingFilePath(templateRef);
    if (!filePath) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const href = pathToFileURL(filePath).href;
      out[href] = content;
      out[templateRef] = content;
      if (templateRaw) out[templateRaw] = content;
    } catch {
      // ignore
    }
  }

  return out;
}

async function processDiagrams(
  html: string,
  browserRenderer: BrowserRenderer | null,
  basePath: string,
  themeConfig: RendererThemeConfig,
  mode: 'img' | 'live' | 'none',
  templatesDir?: string | string[],
  cdnOverrides?: Md2HtmlOptions['cdn']
): Promise<string> {
  if (mode !== 'img') return html;
  if (!browserRenderer) return html;

  // md2x templates are local files. Pre-load them on the Node side to avoid file:// fetch issues in the browser page.
  const md2xTemplateFiles = collectMd2xTemplateFiles(html, basePath, templatesDir);

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
              templateFiles: md2xTemplateFiles,
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
  templatesDir?: string | string[],
  cdnOverrides?: Md2HtmlOptions['cdn']
): Promise<string> {
  // Import markdown processor dynamically
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkGfm = (await import('remark-gfm')).default;
  const remarkMath = (await import('remark-math')).default;
  const remarkSuperSub = (await import('../../../src/plugins/remark-super-sub')).default;
  const remarkRehype = (await import('remark-rehype')).default;
  const rehypeKatex = (await import('rehype-katex')).default;
  const rehypeHighlight = (await import('rehype-highlight')).default;
  const rehypeStringify = (await import('rehype-stringify')).default;
  const { visit } = await import('unist-util-visit');

  // Rehype plugin to mark block-level images
  // An image is block-level only if:
  // 1. It's the only image in the paragraph
  // 2. There's no substantial text content (only labels like "**text:**" before the image are OK)
  function rehypeBlockImages() {
    return (tree: any) => {
      visit(tree, 'element', (node: any) => {
        if (node.tagName !== 'p') return;

        const children = node.children || [];
        if (children.length === 0) return;

        // Count images and check for text content
        let imageCount = 0;
        let imageIndex = -1;
        let hasSubstantialTextAfterImage = false;
        let foundImage = false;

        for (let i = 0; i < children.length; i++) {
          const child = children[i];

          if (child.type === 'element' && child.tagName === 'img') {
            imageCount++;
            imageIndex = i;
            foundImage = true;
          } else if (foundImage) {
            // Check for text after the image
            if (child.type === 'text' && child.value.trim() !== '') {
              hasSubstantialTextAfterImage = true;
            } else if (child.type === 'element' && child.tagName !== 'br') {
              // Any element after image (except br) means it's inline
              hasSubstantialTextAfterImage = true;
            }
          }
        }

        // Only mark as block-image if:
        // - Exactly one image in the paragraph
        // - No substantial text after the image
        if (imageCount === 1 && !hasSubstantialTextAfterImage && imageIndex >= 0) {
          const img = children[imageIndex];
          img.properties = img.properties || {};
          const existingClass = img.properties.className || [];
          img.properties.className = Array.isArray(existingClass)
            ? [...existingClass, 'block-image']
            : [existingClass, 'block-image'];
        }
      });
    };
  }

  // Create processor
  const processor = unified()
    .use(remarkParse)
    // Keep consistent with extension/webview + DOCX: reserve single `~text~` for subscript.
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkSuperSub)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeHighlight)
    .use(rehypeBlockImages)
    .use(rehypeStringify, { allowDangerousHtml: true });

  // Process markdown
  const file = await processor.process(markdown);
  let html = String(file);

  // Process diagrams (mermaid, graphviz, vega-lite, etc.)
  html = await processDiagrams(html, browserRenderer, basePath, themeConfig, diagramMode, templatesDir, cdnOverrides);

  return html;
}

function buildLiveDiagramBootstrap(
  themeConfig: RendererThemeConfig | null,
  baseHref: string,
  cdnOverrides: Md2HtmlOptions['cdn'] | undefined,
  md2xTemplateFiles: Record<string, string> | undefined
): string {
  // Prevent `</script>` inside embedded JSON (e.g., Vue SFC source) from terminating the bootstrap script tag.
  const jsonForInlineScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

    const cdnBaseDefaults = {
      mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.min.js',
    // Preferred: modern Graphviz WASM build (provides window.Viz.instance()).
    vizGlobal: 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3.24.0/dist/viz-global.js',
    // Legacy fallback (provides window.Viz constructor).
    viz: 'https://cdn.jsdelivr.net/npm/viz.js@2.1.2/viz.js',
    vizRender: 'https://cdn.jsdelivr.net/npm/viz.js@2.1.2/full.render.js',
    infographic: 'https://cdn.jsdelivr.net/npm/@antv/infographic@0.2.7/dist/infographic.min.js',
    // For md2x template blocks (Vue SFC).
    vue: 'https://unpkg.com/vue@3/dist/vue.global.js',
    vueSfcLoader: 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader/dist/vue3-sfc-loader.js',
    // For md2x template blocks (Svelte 5).
    // NOTE: We intentionally use esm.sh so the compiler (and its dependencies) can load in browsers via `import()`.
    svelteCompiler: 'https://esm.sh/svelte@5/compiler',
    // Runtime module base (used to rewrite bare imports like "svelte/internal/client").
    svelteBase: 'https://esm.sh/svelte@5/',
  } as const;

  const cdnVegaDefaultsByMajor = {
    // Vega-Lite v5 is typically used with Vega v5 + Vega-Embed v6.
    5: {
      vega: 'https://cdn.jsdelivr.net/npm/vega@5/build/vega.min.js',
      vegaLite: 'https://cdn.jsdelivr.net/npm/vega-lite@5/build/vega-lite.min.js',
      vegaEmbed: 'https://cdn.jsdelivr.net/npm/vega-embed@6/build/vega-embed.min.js',
    },
    // Vega-Lite v6 is typically used with Vega v6 + Vega-Embed v7.
    6: {
      vega: 'https://cdn.jsdelivr.net/npm/vega@6/build/vega.min.js',
      vegaLite: 'https://cdn.jsdelivr.net/npm/vega-lite@6/build/vega-lite.min.js',
      vegaEmbed: 'https://cdn.jsdelivr.net/npm/vega-embed@7/build/vega-embed.min.js',
    },
  } as const;

  return `
  <!-- md2x live diagram renderer (CDN) -->
  <script>
  (function () {
    const themeConfig = ${jsonForInlineScript(themeConfig ?? null)};
    const baseHref = ${jsonForInlineScript(baseHref)};
    const cdnOverrides = ${jsonForInlineScript(cdnOverrides ?? {})};
    const cdnBaseDefaults = ${jsonForInlineScript(cdnBaseDefaults)};
    const cdnVegaDefaultsByMajor = ${jsonForInlineScript(cdnVegaDefaultsByMajor)};
    const md2xTemplateFiles = ${jsonForInlineScript(md2xTemplateFiles ?? {})};

    try { window.__md2xLiveDone = false; } catch {}

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => { try { s.__md2xLoaded = true; } catch {} resolve(); };
        s.onerror = () => { try { s.__md2xLoaded = true; } catch {} reject(new Error('Failed to load script: ' + src)); };
        document.head.appendChild(s);
      });
    }

    function normalizeStringList(value) {
      if (!Array.isArray(value)) return [];
      const out = [];
      const seen = new Set();
      for (const v of value) {
        if (typeof v !== 'string') continue;
        const s = v.trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
    }

    function normalizeTemplateConfig(value) {
      if (!value || typeof value !== 'object') return null;
      const assets = value.assets;
      if (!assets || typeof assets !== 'object') return null;
      const scripts = normalizeStringList(assets.scripts);
      const styles = normalizeStringList(assets.styles);
      if (!scripts.length && !styles.length) return null;
      return { assets: { scripts, styles } };
    }

    function extractTemplateConfigFromHead(source) {
      const raw = String(source || '');
      if (!raw) return { source: raw, templateConfig: null };

      let i = 0;
      // BOM
      if (raw.charCodeAt(0) === 0xfeff) i = 1;
      // leading whitespace/newlines
      while (i < raw.length) {
        const ch = raw[i];
        if (ch === ' ' || ch === '\\t' || ch === '\\n' || ch === '\\r') i++;
        else break;
      }

      if (raw.slice(i, i + 4) !== '<!--') return { source: raw, templateConfig: null };
      const end = raw.indexOf('-->', i + 4);
      if (end === -1) return { source: raw, templateConfig: null };

      const commentBody = raw.slice(i + 4, end).trim();
      const prefix = 'TemplateConfig:';
      if (commentBody.slice(0, prefix.length) !== prefix) return { source: raw, templateConfig: null };

      const jsonText = commentBody.slice(prefix.length).trim();

      // Strip the header comment even if parsing fails (so SFC/Svelte compilers won't choke on it).
      let after = raw.slice(end + 3);
      if (after.slice(0, 2) === '\\r\\n') after = after.slice(2);
      else if (after[0] === '\\n' || after[0] === '\\r') after = after.slice(1);
      const cleaned = raw.slice(0, i) + after;

      if (!jsonText) return { source: cleaned, templateConfig: null };

      try {
        const parsed = JSON.parse(jsonText);
        return { source: cleaned, templateConfig: normalizeTemplateConfig(parsed) };
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        return { source: cleaned, templateConfig: null, error: msg };
      }
    }

    function loadCssOnce(href) {
      const url = resolveHref(href, baseHref || undefined);
      if (!url) return Promise.resolve();
      const esc = (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(url) : String(url).replace(/"/g, '\\\\\"');
      const existing = document.querySelector('link[rel="stylesheet"][href="' + esc + '"]');
      if (existing) return Promise.resolve();

      return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.appendChild(link);
      });
    }

    function loadScriptOnce(src, globalName) {
      if (globalName) {
        try {
          if (window[globalName]) return Promise.resolve();
        } catch {}
      }

      const url = resolveHref(src, baseHref || undefined);
      if (!url) return Promise.resolve();

      const esc = (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(url) : String(url).replace(/"/g, '\\\\\"');
      const existing = document.querySelector('script[src="' + esc + '"]');
      if (existing) {
        if (existing.__md2xLoaded) return Promise.resolve();
        return new Promise((resolve, reject) => {
          existing.addEventListener('load', () => { try { existing.__md2xLoaded = true; } catch {} resolve(); }, { once: true });
          existing.addEventListener('error', () => reject(new Error('Failed to load script: ' + url)), { once: true });
        });
      }

      return loadScript(url).then(() => {
        try {
          const el = document.querySelector('script[src="' + esc + '"]');
          if (el) el.__md2xLoaded = true;
        } catch {}
      });
    }

    async function loadTemplateAssets(templateConfig) {
      const scripts = normalizeStringList(templateConfig && templateConfig.assets ? templateConfig.assets.scripts : null);
      const styles = normalizeStringList(templateConfig && templateConfig.assets ? templateConfig.assets.styles : null);
      for (const href of styles) {
        await loadCssOnce(href);
      }
      for (const src of scripts) {
        await loadScriptOnce(src);
      }
    }

    let __md2xSvelteCompilerPromise = null;

    function getCdnValue(key) {
      try {
        if (cdnOverrides && Object.prototype.hasOwnProperty.call(cdnOverrides, key) && cdnOverrides[key]) return cdnOverrides[key];
      } catch {}
      return cdnBaseDefaults[key];
    }

    function normalizeUrlBase(base) {
      const b = String(base || '').trim();
      if (!b) return b;
      return b.endsWith('/') ? b : (b + '/');
    }

    function normalizePkgEntryUrl(base) {
      const b = String(base || '').trim();
      if (!b) return b;
      return b.endsWith('/') ? b.slice(0, -1) : b;
    }

    function rewriteSvelteModuleSpecifiers(code, svelteBase) {
      const base = normalizeUrlBase(svelteBase);
      if (!base) return String(code || '');

      const resolve = (p) => {
        try { return new URL(p, base).href; } catch { return base + p; }
      };

      const isEsmSh = base.indexOf('esm.sh/') !== -1;
      const entry = normalizePkgEntryUrl(base);

      const map = {
        // Svelte 5 runtime imports:
        'svelte': isEsmSh ? entry : resolve('src/runtime/index.js'),
        'svelte/internal': isEsmSh ? resolve('internal') : resolve('src/runtime/internal/index.js'),
        'svelte/internal/client': isEsmSh ? resolve('internal/client') : resolve('src/runtime/internal/client/index.js'),
        'svelte/internal/server': isEsmSh ? resolve('internal/server') : resolve('src/runtime/internal/server/index.js'),
        'svelte/internal/disclose-version': isEsmSh
          ? resolve('internal/disclose-version')
          : resolve('src/runtime/internal/disclose-version/index.js'),
        'svelte/store': isEsmSh ? resolve('store') : resolve('src/runtime/store/index.js'),
        'svelte/animate': isEsmSh ? resolve('animate') : resolve('src/runtime/animate/index.js'),
        'svelte/easing': isEsmSh ? resolve('easing') : resolve('src/runtime/easing/index.js'),
        'svelte/motion': isEsmSh ? resolve('motion') : resolve('src/runtime/motion/index.js'),
        'svelte/transition': isEsmSh ? resolve('transition') : resolve('src/runtime/transition/index.js'),
      };

      let out = String(code || '');
      for (const k in map) {
        const v = map[k];
        out = out.split("'" + k + "'").join("'" + v + "'");
        out = out.split('"' + k + '"').join('"' + v + '"');
      }

      // Catch-all for any remaining Svelte subpath imports like:
      //   "svelte/internal/flags/legacy"
      //   "svelte/internal/client"
      // We only support esm.sh, so rewrite bare "svelte/<...>" to absolute URLs.
      if (isEsmSh && entry) {
        out = out.split("'svelte/").join("'" + entry + '/');
        out = out.split('"svelte/').join('"' + entry + '/');
      }
      return out;
    }

    async function loadSvelteCompilerModule() {
      if (__md2xSvelteCompilerPromise) return __md2xSvelteCompilerPromise;
      const url = getCdnValue('svelteCompiler');
      __md2xSvelteCompilerPromise = import(url);
      return __md2xSvelteCompilerPromise;
    }

    function getLangFromCodeClass(codeEl) {
      const cls = (codeEl && codeEl.className) ? String(codeEl.className) : '';
      const m = cls.match(/\\blanguage-([a-z0-9-]+)\\b/i);
      return m ? m[1] : '';
    }

    function normalizeLang(lang) {
      const l = String(lang || '').toLowerCase();
      if (l === 'graphviz' || l === 'gv') return 'dot';
      if (l === 'vegalite') return 'vega-lite';
      return l;
    }

    function resolveHref(url, base) {
      const u = String(url || '').trim();
      if (!u) return '';
      try {
        return new URL(u, base || undefined).href;
      } catch {
        return u;
      }
    }

    function normalizeMd2xTemplateRef(type, tpl) {
      const t = String(type || '').trim().toLowerCase();
      const v = String(tpl || '').trim();
      if (!t || !v) return v;
      // If user already provided a path/URL, keep it.
      if (v.indexOf('/') !== -1 || v.indexOf('\\\\') !== -1 || v.indexOf('://') !== -1 || v.indexOf('file://') === 0) return v;
      return t + '/' + v;
    }

    function detectMd2xNeedsVueFromDocument() {
      const blocks = Array.from(document.querySelectorAll('pre > code'));
      for (const codeEl of blocks) {
        const langRaw = getLangFromCodeClass(codeEl);
        const lang = normalizeLang(langRaw);
        if (lang !== 'md2x') continue;
        const text = (codeEl && codeEl.textContent) ? codeEl.textContent : '';
        if (!text.trim()) continue;
        // Fast path without parsing: the common config format includes type: 'vue'
        if (/\\btype\\s*:\\s*['\\\"]vue['\\\"]/i.test(text)) return true;
        try {
          const cfg = parseMd2xConfig(text);
          if (cfg && cfg.type === 'vue') return true;
        } catch {}
      }
      return false;
    }

    function guessVegaLiteSchemaMajorFromSpec(spec) {
      if (!spec || typeof spec !== 'object') return null;
      const schema = spec.$schema;
      if (typeof schema !== 'string') return null;
      const m = schema.match(/\\/vega-lite\\/v(\\d+)(?:\\.|\\.json|$)/i) || schema.match(/\\/v(\\d+)\\.json$/i);
      if (!m) return null;
      const major = parseInt(m[1], 10);
      return Number.isFinite(major) ? major : null;
    }

    function guessVegaLiteSchemaMajorFromText(text) {
      const t = String(text || '');
      const m = t.match(/\\/vega-lite\\/v(\\d+)(?:\\.|\\.json|$)/i) || t.match(/\\/v(\\d+)\\.json$/i);
      if (!m) return null;
      const major = parseInt(m[1], 10);
      return Number.isFinite(major) ? major : null;
    }

    function detectVegaLiteMajorFromDocument() {
      const blocks = Array.from(document.querySelectorAll('pre > code'));
      let detected = null;
      for (const codeEl of blocks) {
        const langRaw = getLangFromCodeClass(codeEl);
        const lang = normalizeLang(langRaw);
        if (lang !== 'vega-lite') continue;

        const text = (codeEl && codeEl.textContent) ? codeEl.textContent : '';
        if (!text.trim()) continue;

        const majorFromText = guessVegaLiteSchemaMajorFromText(text);
        if (majorFromText && (majorFromText === 5 || majorFromText === 6)) {
          detected = majorFromText;
          if (majorFromText === 6) return 6;
          continue;
        }

        try {
          const spec = JSON.parse(text);
          const major = guessVegaLiteSchemaMajorFromSpec(spec);
          if (major && (major === 5 || major === 6)) {
            detected = major;
            if (major === 6) return 6;
          }
        } catch {}
      }
      return detected || 6;
    }

    function detectLiveKindsFromDocument() {
      const blocks = Array.from(document.querySelectorAll('pre > code'));
      const out = {
        mermaid: false,
        dot: false,
        vegaLite: false,
        infographic: false,
        md2xVue: false,
        md2xHtml: false,
        md2xSvelte: false,
      };

      for (const codeEl of blocks) {
        const langRaw = getLangFromCodeClass(codeEl);
        if (!langRaw) continue;
        const lang = normalizeLang(langRaw);

        if (lang === 'mermaid') out.mermaid = true;
        else if (lang === 'dot') out.dot = true;
        else if (lang === 'vega-lite') out.vegaLite = true;
        else if (lang === 'infographic') out.infographic = true;
        else if (lang === 'md2x') {
          const text = (codeEl && codeEl.textContent) ? codeEl.textContent : '';
          const cfg = parseMd2xConfig(text);
          if (cfg && cfg.type === 'vue') out.md2xVue = true;
          if (cfg && cfg.type === 'html') out.md2xHtml = true;
          if (cfg && cfg.type === 'svelte') out.md2xSvelte = true;
        }
      }

      return out;
    }

    async function ensureCdnLibsLoaded() {
      const kinds = detectLiveKindsFromDocument();

      // Only include Vega URLs if we actually need Vega-Lite (reduces failure surface when offline).
      const major = kinds.vegaLite ? detectVegaLiteMajorFromDocument() : 6;
      const vegaDefaults = cdnVegaDefaultsByMajor[String(major)] || cdnVegaDefaultsByMajor['6'];
      const cdn = Object.assign({}, cdnBaseDefaults, vegaDefaults, cdnOverrides || {});

      // Load only what we need; never throw here (so other kinds can still render).
      if (kinds.mermaid) {
        try { await loadScript(cdn.mermaid); } catch {}
      }
      if (kinds.dot) {
        try {
          if (cdn.vizGlobal) {
            await loadScript(cdn.vizGlobal);
          } else {
            await loadScript(cdn.viz);
            await loadScript(cdn.vizRender);
          }
        } catch {}
      }
      if (kinds.vegaLite) {
        try {
          await loadScript(cdn.vega);
          await loadScript(cdn.vegaLite);
          await loadScript(cdn.vegaEmbed);
        } catch {}
      }
      if (kinds.infographic) {
        try { await loadScript(cdn.infographic); } catch {}
      }

      // md2x templates:
      if (kinds.md2xVue) {
        try {
          await loadScript(cdn.vue);
          await loadScript(cdn.vueSfcLoader);
        } catch {}
      }
      if (kinds.md2xSvelte) {
        try {
          // Warm up the compiler module so rendering multiple blocks is faster.
          await import(cdn.svelteCompiler);
        } catch {}
      }
    }

    function replacePreWithContainer(preEl, kind) {
      const wrapper = document.createElement('div');
      wrapper.className = 'md2x-diagram';
      wrapper.setAttribute('data-md2x-diagram-kind', kind);
      wrapper.style.maxWidth = '100%';
      const inner = document.createElement('div');
      inner.className = 'md2x-diagram-inner';
      inner.style.display = 'inline-block';
      inner.style.maxWidth = '100%';
      const mount = document.createElement('div');
      mount.className = 'md2x-diagram-mount';
      mount.style.maxWidth = '100%';
      inner.appendChild(mount);
      wrapper.appendChild(inner);
      preEl.replaceWith(wrapper);
      return mount;
    }

    function getText(codeEl) {
      return (codeEl && codeEl.textContent) ? codeEl.textContent : '';
    }

    async function renderMermaid(code, mount, id) {
      const mermaid = window.mermaid;
      if (!mermaid) return;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: themeConfig && themeConfig.fontFamily ? themeConfig.fontFamily : undefined,
      });
      const out = await mermaid.render('md2x-mermaid-' + id, code);
      mount.innerHTML = out && out.svg ? out.svg : '';
    }

    async function renderDot(code, mount) {
      const VizGlobal = window.Viz;
      if (VizGlobal && typeof VizGlobal.instance === 'function') {
        const viz = await VizGlobal.instance();
        const svgEl = viz.renderSVGElement(code, { graphAttributes: { bgcolor: 'transparent' } });
        mount.appendChild(svgEl);
        return;
      }
      if (typeof window.Viz === 'function') {
        const viz = new window.Viz();
        const svgEl = await viz.renderSVGElement(code);
        mount.appendChild(svgEl);
      }
    }

    function applyDefaultVegaLiteSort(spec) {
      const applyOne = (s) => {
        if (!s || typeof s !== 'object') return;
        const enc = s.encoding;
        const x = enc && enc.x;
        if (x && typeof x === 'object' && x.type === 'ordinal' && !('sort' in x)) {
          x.sort = null;
        }
      };

      const walk = (s) => {
        if (!s || typeof s !== 'object') return;
        applyOne(s);
        const arrays = ['layer', 'hconcat', 'vconcat', 'concat'];
        for (const key of arrays) {
          const childArr = s[key];
          if (Array.isArray(childArr)) {
            for (const child of childArr) walk(child);
          }
        }
        if (s.spec) walk(s.spec);
      };
      walk(spec);
    }

    async function renderVegaLite(code, mount) {
      const vegaEmbed = window.vegaEmbed;
      if (typeof vegaEmbed !== 'function') return;
      let spec;
      try {
        spec = JSON.parse(code);
      } catch {
        mount.textContent = 'Invalid Vega-Lite JSON.';
        return;
      }
      if (!spec) return;

      try {
        applyDefaultVegaLiteSort(spec);
      } catch {}

      await vegaEmbed(mount, spec, {
        actions: false,
        renderer: 'svg',
        defaultStyle: true,
        logLevel: (window.vega && window.vega.Warn) ? window.vega.Warn : undefined,
      }).catch(() => {});
    }

    async function renderInfographic(code, mount) {
      // @antv/infographic UMD exposes window.AntVInfographic
      const lib = window.AntVInfographic;
      if (!lib || !lib.Infographic) return;

      try {
        if (typeof lib.setDefaultFont === 'function') {
          const ff = themeConfig && themeConfig.fontFamily ? themeConfig.fontFamily : undefined;
          if (ff) lib.setDefaultFont(ff);
        }
      } catch {}

      const opts = {
        container: mount,
        width: 900,
        height: 600,
        padding: 24,
      };
      if (themeConfig && themeConfig.diagramStyle === 'handDrawn') {
        opts.themeConfig = { stylize: { type: 'rough', roughness: 0.5, bowing: 0.5 } };
      }

      const ig = new lib.Infographic(opts);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Infographic render timeout after 10s')), 10000);
        ig.on && ig.on('rendered', () => { clearTimeout(timeout); resolve(); });
        ig.on && ig.on('error', (err) => { clearTimeout(timeout); reject(err); });
        try {
          ig.render(code);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      }).catch(() => {
        // keep container content on errors
      });
    }

    function parseMd2xConfig(text) {
      const raw = String(text || '').trim();
      if (!raw) return null;

      // The md2x block format is treated as a JS object literal (often without outer braces).
      // Example:
      //   type: 'vue',
      //   template: 'vue/my-component.vue',
      //   data: [...]
      let expr = raw.replace(/^export\\s+default\\s+/i, '').trim();
      if (!expr) return null;
      if (!/^\\s*\\{[\\s\\S]*\\}\\s*$/.test(expr)) {
        expr = '{' + expr + '}';
      }

      let cfg;
      try {
        // eslint-disable-next-line no-new-func
        cfg = Function('\"use strict\"; return (' + expr + ');')();
      } catch {
        return null;
      }

      if (!cfg || typeof cfg !== 'object') return null;
      const type = (cfg.type != null) ? String(cfg.type).toLowerCase() : '';
      const template = (cfg.template != null) ? String(cfg.template) : '';
      const data = cfg.data;
      const allowTemplateAssets =
        (typeof cfg.allowTemplateAssets === 'boolean')
          ? cfg.allowTemplateAssets
          : ((typeof cfg.allowCdn === 'boolean') ? cfg.allowCdn : false);
      if (type !== 'vue' && type !== 'html' && type !== 'svelte') return null;
      if (!template) return null;
      return { type, template, data, allowTemplateAssets };
    }

    async function renderMd2xHtml(cfg, mount) {
      try {
        const templateRef = normalizeMd2xTemplateRef(cfg.type, cfg.template);
        const tplHref = resolveHref(templateRef, baseHref || undefined);
        const tpl = md2xTemplateFiles[tplHref] || md2xTemplateFiles[templateRef] || md2xTemplateFiles[cfg.template];
        if (typeof tpl !== 'string' || !tpl) {
          mount.textContent = 'Missing md2x html template: ' + templateRef;
          return;
        }

        const extracted = extractTemplateConfigFromHead(tpl);
        if (cfg.allowTemplateAssets) {
          if (extracted.error) {
            mount.textContent = 'Invalid TemplateConfig JSON: ' + extracted.error;
            return;
          }
          try {
            await loadTemplateAssets(extracted.templateConfig);
          } catch (e) {
            mount.textContent = 'Failed to load TemplateConfig assets.';
            return;
          }
        }

        // Same data-injection approach as md2x Vue templates: replace the templateData placeholder.
        const json = (() => {
          try {
            const j = JSON.stringify(cfg.data ?? null);
            // Avoid accidentally terminating an inline <script> tag if user data contains "</...".
            // IMPORTANT: avoid including the literal closing script tag sequence in this bootstrap source code.
            return j.split('</').join('<\\/');
          } catch {
            return 'null';
          }
        })();
        mount.innerHTML = extracted.source.split('templateData').join('(' + json + ')');

        // Browsers treat <script> tags inserted via innerHTML as inert (they won't execute).
        // Re-create them in-place to allow "script + markup in one HTML file" templates.
        const scripts = Array.from(mount.querySelectorAll('script'));
        for (const old of scripts) {
          const parent = old.parentNode;
          if (!parent) continue;

          const s = document.createElement('script');
          for (const attr of Array.from(old.attributes || [])) {
            const name = String(attr && attr.name ? attr.name : '');
            if (!name) continue;
            // Keep execution order predictable (parser-blocking semantics).
            if (name === 'async' || name === 'defer') continue;
            try {
              s.setAttribute(name, attr.value);
            } catch {}
          }

          const src = old.getAttribute('src');
          let wait = null;
          if (src) {
            // Force sequential loading/execution for deterministic template behavior.
            try { s.async = false; } catch {}
            wait = new Promise((resolve) => {
              s.onload = () => resolve(null);
              s.onerror = () => resolve(null);
            });
            // Resolve relative src against baseHref (file://.../).
            const href = resolveHref(src, baseHref || undefined);
            s.setAttribute('src', href);
          } else {
            s.textContent = old.textContent || '';
          }

          parent.replaceChild(s, old);
          if (wait) {
            try { await wait; } catch {}
          }
        }
      } catch (e) {
        mount.textContent = 'Failed to render md2x html template.';
      }
    }

    async function renderMd2xVue(cfg, mount) {
      const Vue = window.Vue;
      const loader = window['vue3-sfc-loader'];
      if (!Vue || !loader || typeof loader.loadModule !== 'function') {
        mount.textContent = 'Vue runtime not available (missing vue/vue3-sfc-loader).';
        return;
      }

      const { loadModule } = loader;
      const fileCache = Object.create(null);

      const templateRef = normalizeMd2xTemplateRef(cfg.type, cfg.template);
      const rootHref = resolveHref(templateRef, baseHref || undefined);
      const rootSource = md2xTemplateFiles[rootHref] || md2xTemplateFiles[templateRef] || md2xTemplateFiles[cfg.template];
      if (typeof rootSource !== 'string' || !rootSource) {
        mount.textContent = 'Missing md2x vue template: ' + templateRef;
        return;
      }

      const extracted = extractTemplateConfigFromHead(rootSource);
      if (cfg.allowTemplateAssets) {
        if (extracted.error) {
          mount.textContent = 'Invalid TemplateConfig JSON: ' + extracted.error;
          return;
        }
        try {
          // Load after Vue runtime is available (common for Vue plugin UMDs).
          await loadTemplateAssets(extracted.templateConfig);
        } catch (e) {
          mount.textContent = 'Failed to load TemplateConfig assets.';
          return;
        }
      }

      // Inject md2x data into the template by replacing the templateData placeholder.
      // This avoids fetch() and also avoids having to require every user template to define props.
      const json = (() => {
        try {
          const j = JSON.stringify(cfg.data ?? null);
          // Prevent any closing tag sequence (e.g. "</div>") inside injected string values from terminating the HTML
          // bootstrap script tag while the page is parsing.
          // IMPORTANT: avoid including the literal closing script tag sequence in this bootstrap source code.
          return j.split('</').join('<\\/');
        } catch {
          return 'null';
        }
      })();
      // NOTE: avoid \\b in this template-literal-generated script (it would become a backspace character).
      const rootPatchedSource = extracted.source.split('templateData').join('(' + json + ')');

      const options = {
        moduleCache: { vue: Vue },
        async getFile(url) {
          const u = String(url || '').trim();
          if (!u) throw new Error('Empty md2x template url');
          if (fileCache[u]) return fileCache[u];

          const href = resolveHref(u, baseHref || undefined);
          if (href === rootHref || u === rootHref) {
            fileCache[u] = rootPatchedSource;
            return rootPatchedSource;
          }
          const text = md2xTemplateFiles[href] || md2xTemplateFiles[u];
          if (typeof text !== 'string') {
            throw new Error('Missing md2x template content for: ' + u);
          }
          fileCache[u] = text;
          return text;
        },
        resolve({ refPath, relPath }) {
          // Ensure nested <script src>, <style src> etc become absolute keys for md2xTemplateFiles lookup.
          try {
            const refHref = resolveHref(refPath, baseHref || undefined);
            return new URL(relPath, refHref).href;
          } catch {
            return relPath;
          }
        },
        addStyle(textContent) {
          const style = document.createElement('style');
          style.textContent = textContent;
          const ref = document.head.getElementsByTagName('style')[0] || null;
          document.head.insertBefore(style, ref);
        },
      };

      let Comp;
      try {
        Comp = await loadModule(rootHref, options);
      } catch (e) {
        mount.textContent = 'Failed to load Vue SFC: ' + cfg.template;
        return;
      }

      // Render the loaded SFC. Data injection is handled by templateData placeholder replacement
      // (so we avoid passing extraneous attrs that can trigger Vue warnings for fragment-root SFCs).
      const app = Vue.createApp({
        render() {
          return Vue.h(Comp);
        },
      });
      app.mount(mount);
      try {
        if (typeof Vue.nextTick === 'function') {
          await Vue.nextTick();
        }
      } catch {}
    }

    async function renderMd2xSvelte(cfg, mount) {
      const templateRef = normalizeMd2xTemplateRef(cfg.type, cfg.template);
      const rootHref = resolveHref(templateRef, baseHref || undefined);
      const rootSource = md2xTemplateFiles[rootHref] || md2xTemplateFiles[templateRef] || md2xTemplateFiles[cfg.template];
      if (typeof rootSource !== 'string' || !rootSource) {
        mount.textContent = 'Missing md2x svelte template: ' + templateRef;
        return;
      }

      const extracted = extractTemplateConfigFromHead(rootSource);
      if (cfg.allowTemplateAssets) {
        if (extracted.error) {
          mount.textContent = 'Invalid TemplateConfig JSON: ' + extracted.error;
          return;
        }
        try {
          await loadTemplateAssets(extracted.templateConfig);
        } catch (e) {
          mount.textContent = 'Failed to load TemplateConfig assets.';
          return;
        }
      }

      const json = (() => {
        try {
          const j = JSON.stringify(cfg.data ?? null);
          // IMPORTANT: avoid including the literal closing script tag sequence in this bootstrap source code.
          return j.split('</').join('<\\/');
        } catch {
          return 'null';
        }
      })();
      const patchedSource = extracted.source.split('templateData').join('(' + json + ')');

      let compilerMod;
      try {
        compilerMod = await loadSvelteCompilerModule();
      } catch (e) {
        mount.textContent = 'Svelte compiler unavailable: ' + ((e && e.message) ? e.message : String(e));
        return;
      }

      const compile =
        (compilerMod && compilerMod.compile) ||
        (compilerMod && compilerMod.default && compilerMod.default.compile);
      if (typeof compile !== 'function') {
        mount.textContent = 'Svelte compiler not available (missing compile()).';
        return;
      }

      let compiled;
      try {
        // Svelte 5 uses generate: "client" (Svelte 4 used generate: "dom"). We only support Svelte 5 here,
        // but keep a fallback for older compiler builds.
        try {
          compiled = compile(patchedSource, { filename: rootHref || templateRef || 'md2x.svelte', generate: 'client' });
        } catch {
          compiled = compile(patchedSource, { filename: rootHref || templateRef || 'md2x.svelte', generate: 'dom' });
        }
      } catch (e) {
        mount.textContent = 'Failed to compile Svelte template: ' + cfg.template;
        return;
      }

      const jsCode = compiled && compiled.js && compiled.js.code ? String(compiled.js.code) : '';
      const cssCode = compiled && compiled.css && compiled.css.code ? String(compiled.css.code) : '';
      if (!jsCode.trim()) {
        mount.textContent = 'Svelte compile returned no JS output.';
        return;
      }

      const svelteBase = getCdnValue('svelteBase');
      const moduleCode = rewriteSvelteModuleSpecifiers(jsCode, svelteBase);

      let blobUrl = '';
      try {
        blobUrl = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
      } catch (e) {
        mount.textContent = 'Unable to create Blob URL for Svelte module.';
        return;
      }

      try {
        let mod;
        try {
          mod = await import(blobUrl);
        } catch (e) {
          mount.textContent = 'Failed to load compiled Svelte module: ' + ((e && e.message) ? e.message : String(e));
          return;
        }

        const Comp = mod && mod.default;
        if (typeof Comp !== 'function') {
          mount.textContent = 'Compiled Svelte module has no default component export.';
          return;
        }

        const svelteEntry = normalizePkgEntryUrl(svelteBase);
        let runtime;
        try {
          runtime = await import(svelteEntry);
        } catch (e) {
          mount.textContent = 'Failed to load Svelte runtime: ' + ((e && e.message) ? e.message : String(e));
          return;
        }

        const mountFn = runtime && runtime.mount;
        if (typeof mountFn !== 'function') {
          mount.textContent = 'Svelte runtime mount() not available.';
          return;
        }

        if (cssCode && cssCode.trim()) {
          const style = document.createElement('style');
          style.textContent = cssCode;
          mount.appendChild(style);
        }

        try {
          // NOTE: keep mounted for printing/PDF.
          mountFn(Comp, { target: mount });
        } catch (e) {
          mount.textContent = 'Failed to mount Svelte component: ' + ((e && e.message) ? e.message : String(e));
          return;
        }
      } finally {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }
    }

    async function main() {
      try {
        if (baseHref) {
          let base = document.querySelector('base');
          if (!base) {
            base = document.createElement('base');
            document.head.appendChild(base);
          }
          base.href = baseHref;
        }
      } catch {}

      await ensureCdnLibsLoaded();

      const blocks = Array.from(document.querySelectorAll('pre > code'));
      let idx = 0;
      for (const codeEl of blocks) {
        const pre = codeEl && codeEl.parentElement;
        if (!pre) continue;
        const langRaw = getLangFromCodeClass(codeEl);
        if (!langRaw) continue;
        const lang = normalizeLang(langRaw);
        const code = getText(codeEl);
        if (!code.trim()) continue;

        try {
          if (lang === 'mermaid') {
            const mount = replacePreWithContainer(pre, 'mermaid');
            await renderMermaid(code, mount, idx++);
          } else if (lang === 'dot') {
            const mount = replacePreWithContainer(pre, 'dot');
            await renderDot(code, mount);
          } else if (lang === 'vega-lite') {
            const mount = replacePreWithContainer(pre, 'vega-lite');
            await renderVegaLite(code, mount);
          } else if (lang === 'infographic') {
            const mount = replacePreWithContainer(pre, 'infographic');
            await renderInfographic(code, mount);
          } else if (lang === 'md2x') {
            const cfg = parseMd2xConfig(code);
            const kind = cfg && cfg.type ? ('md2x-' + cfg.type) : 'md2x';
            const mount = replacePreWithContainer(pre, kind);
            if (!cfg) {
              mount.textContent = 'Invalid md2x block.';
              continue;
            }
            if (cfg.type === 'vue') {
              await renderMd2xVue(cfg, mount);
            } else if (cfg.type === 'html') {
              await renderMd2xHtml(cfg, mount);
            } else if (cfg.type === 'svelte') {
              await renderMd2xSvelte(cfg, mount);
            }
          }
        } catch {}
      }

      try { window.__md2xLiveDone = true; } catch {}
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
    } else {
      main();
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

      const themeConfig = await loadRendererThemeConfig(themeId);
      const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, basePath, options.templatesDir);
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

/**
 * Load theme CSS for PDF export
 */
async function loadThemeCss(themeId: string): Promise<string> {
  const platform = globalThis.platform as any;

  // Initialize themeManager first (required for font config)
  const themeManager = (await import('../../../src/utils/theme-manager')).default;
  await themeManager.initialize();

  // Load theme preset
  const themeText = await platform.resource.fetch(`themes/presets/${themeId}.json`);
  const theme = JSON.parse(themeText);

  // Load layout scheme
  const layoutText = await platform.resource.fetch(`themes/layout-schemes/${theme.layoutScheme}.json`);
  const layoutScheme = JSON.parse(layoutText);

  // Load color scheme
  const colorText = await platform.resource.fetch(`themes/color-schemes/${theme.colorScheme}.json`);
  const colorScheme = JSON.parse(colorText);

  // Load table style
  const tableText = await platform.resource.fetch(`themes/table-styles/${theme.tableStyle}.json`);
  const tableStyle = JSON.parse(tableText);

  // Load code theme
  const codeText = await platform.resource.fetch(`themes/code-themes/${theme.codeTheme}.json`);
  const codeTheme = JSON.parse(codeText);

  // Import theme-to-css dynamically to avoid circular dependencies
  const { themeToCSS } = await import('../../../src/utils/theme-to-css');
  return themeToCSS(theme, layoutScheme, colorScheme, tableStyle, codeTheme);
}

/**
 * Load base CSS styles for PDF
 */
async function loadBaseCss(hrAsPageBreak: boolean = true): Promise<string> {
  // Base styles for markdown rendering
  // When hrAsPageBreak is true, hr elements will trigger page breaks
  const hrStyles = hrAsPageBreak
    ? `
/* Horizontal Rule as Page Break */
hr {
  height: 0;
  padding: 0;
  margin: 0;
  background-color: transparent;
  border: 0;
  page-break-after: always;
  break-after: page;
  visibility: hidden;
}`
    : `
/* Horizontal Rule */
hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #e1e4e8;
  border: 0;
}`;

  return `
/* Base PDF Styles */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
  color: #333;
}

.markdown-body, #markdown-content {
  max-width: 100%;
  padding: 20px;
}

/* Wide content auto-scaling for PDF */
/* Use transform scale to fit wide content within page width */
/* The actual scale value will be set dynamically via JavaScript */
#markdown-content > div[style*="width"] {
  transform-origin: top left;
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #6a737d; }

/* Paragraphs */
p {
  margin-top: 0;
  margin-bottom: 16px;
}

/* Links */
a {
  color: #0366d6;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

/* Lists */
ul, ol {
  padding-left: 2em;
  margin-top: 0;
  margin-bottom: 16px;
}

li {
  margin-bottom: 4px;
}

li + li {
  margin-top: 4px;
}

/* Code */
code {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(27, 31, 35, 0.05);
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

pre {
  padding: 16px;
  /* PDFs can't scroll horizontally; wrap long lines instead of clipping. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 3px;
  margin-top: 0;
  margin-bottom: 16px;
}

pre code {
  padding: 0;
  margin: 0;
  font-size: 100%;
  background-color: transparent;
  border: 0;
  /* Inherit wrapping behavior from <pre> for PDFs */
  white-space: inherit;
  overflow-wrap: inherit;
  word-break: inherit;
}

/* Blockquotes */
blockquote {
  padding: 0 1em;
  color: #6a737d;
  border-left: 0.25em solid #dfe2e5;
  margin: 0 0 16px 0;
}

blockquote > :first-child {
  margin-top: 0;
}

blockquote > :last-child {
  margin-bottom: 0;
}

/* Tables */
table {
  border-collapse: collapse;
  border-spacing: 0;
  margin-top: 0;
  margin-bottom: 16px;
  width: auto;
}

th, td {
  padding: 6px 13px;
  border: 1px solid #dfe2e5;
}

th {
  font-weight: 600;
  background-color: #f6f8fa;
}

tr:nth-child(2n) {
  background-color: #f6f8fa;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  box-sizing: content-box;
}

/* Diagrams (rendered images) */
.md2x-diagram {
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}

.md2x-diagram .md2x-diagram-inner {
  display: inline-block;
  max-width: 100%;
  text-align: left;
}

.md2x-diagram .md2x-diagram-mount {
  display: inline-block;
  max-width: 100%;
}

.md2x-diagram .vega-embed {
  display: inline-block;
  max-width: 100%;
  width: auto !important;
}

.md2x-diagram .md2x-diagram-inner svg,
.md2x-diagram .md2x-diagram-inner > svg {
  display: block;
  margin-left: auto;
  margin-right: auto;
  max-width: 100%;
}

.md2x-diagram img,
img.md2x-diagram {
  display: block;
  max-width: 100%;
  height: auto;
  margin-left: auto;
  margin-right: auto;
  break-inside: avoid;
  page-break-inside: avoid;
}

#markdown-content svg {
  display: block;
  margin-left: auto;
  margin-right: auto;
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Block-level images: marked by rehypeBlockImages plugin */
img.block-image {
  display: block;
  margin: 16px 0;
}

/* Task Lists */
.task-list-item {
  list-style-type: none;
}

.task-list-item input {
  margin: 0 0.2em 0.25em -1.6em;
  vertical-align: middle;
}

/* KaTeX Math */
.katex {
  font-size: 1.1em;
}

.katex-display {
  margin: 1em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* Syntax Highlighting - GitHub style */
.hljs {
  display: block;
  overflow-x: auto;
  color: #24292e;
  background: #f6f8fa;
}

.hljs-comment,
.hljs-quote {
  color: #6a737d;
  font-style: italic;
}

.hljs-keyword,
.hljs-selector-tag,
.hljs-subst {
  color: #d73a49;
}

.hljs-number,
.hljs-literal,
.hljs-variable,
.hljs-template-variable,
.hljs-tag .hljs-attr {
  color: #005cc5;
}

.hljs-string,
.hljs-doctag {
  color: #032f62;
}

.hljs-title,
.hljs-section,
.hljs-selector-id {
  color: #6f42c1;
  font-weight: bold;
}

.hljs-type,
.hljs-class .hljs-title {
  color: #6f42c1;
}

.hljs-tag,
.hljs-name,
.hljs-attribute {
  color: #22863a;
}

.hljs-regexp,
.hljs-link {
  color: #032f62;
}

.hljs-symbol,
.hljs-bullet {
  color: #e36209;
}

.hljs-built_in,
.hljs-builtin-name {
  color: #005cc5;
}

.hljs-meta {
  color: #6a737d;
  font-weight: bold;
}

.hljs-deletion {
  color: #b31d28;
  background-color: #ffeef0;
}

.hljs-addition {
  color: #22863a;
  background-color: #f0fff4;
}

.hljs-emphasis {
  font-style: italic;
}

.hljs-strong {
  font-weight: bold;
}

${hrStyles}
`;
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

      const themeConfig = await loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'img';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templatesDir, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFiles(html, basePath, options.templatesDir);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles);
      }

      // Load CSS
      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for PDF export:', e);
      }
      const baseCss = await loadBaseCss(options.hrAsPageBreak ?? true);
      let themeCss = '';
      try {
        themeCss = await loadThemeCss(themeId);
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

      const themeConfig = await loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'live';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templatesDir, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFiles(html, basePath, options.templatesDir);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles);
      }

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for image export:', e);
      }

      const baseCss = await loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = await loadThemeCss(themeId);
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

      const themeConfig = await loadRendererThemeConfig(themeId);

      const diagramMode: 'img' | 'live' | 'none' = options.diagramMode ?? 'live';
      let html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templatesDir, options.cdn);
      if (diagramMode === 'live') {
        const baseHref = pathToFileURL(basePath + path.sep).href;
        const md2xTemplateFiles = collectMd2xTemplateFiles(html, basePath, options.templatesDir);
        html = html + '\n' + buildLiveDiagramBootstrap(themeConfig ?? null, baseHref, options.cdn, md2xTemplateFiles);
      }

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for image export:', e);
      }

      const baseCss = await loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = await loadThemeCss(themeId);
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
      const themeConfig = await loadRendererThemeConfig(themeId);

      if (diagramMode === 'img') {
        browserRenderer = await createBrowserRenderer();
        if (browserRenderer) {
          await browserRenderer.initialize();
        }
      }

      const fragment = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode, options.templatesDir, options.cdn);

      const standalone = options.standalone !== false;
      if (!standalone) return fragment;

      let katexCss = '';
      try {
        katexCss = loadKatexCss();
      } catch (e) {
        console.warn('Failed to load KaTeX CSS for HTML export:', e);
      }

      const baseCss = await loadBaseCss(options.hrAsPageBreak ?? false);

      let themeCss = '';
      try {
        themeCss = await loadThemeCss(themeId);
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
          collectMd2xTemplateFiles(fragment, basePath, options.templatesDir)
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

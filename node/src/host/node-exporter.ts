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
import DocxExporter from '../../../src/exporters/docx-exporter';
import { createBrowserRenderer, type BrowserRenderer, type PdfOptions } from './browser-renderer';
import { createNodePlatform } from './node-platform';
import { plugins } from '../../../src/plugins/index';
import type { PluginRenderer, RendererThemeConfig } from '../../../src/types/index';

export type Md2DocxOptions = {
  theme?: string;
  basePath?: string;
  /** When true, horizontal rules (---, ***, ___) will be converted to page breaks (default: true) */
  hrAsPageBreak?: boolean;
};

export type Md2PdfOptions = {
  theme?: string;
  basePath?: string;
  pdf?: PdfOptions;
  /** When true, horizontal rules (---, ***, ___) will be converted to page breaks */
  hrAsPageBreak?: boolean;
};

export type Md2HtmlOptions = {
  theme?: string;
  basePath?: string;
  /** Document title for standalone HTML output */
  title?: string;
  /** When true, returns a full HTML document with embedded CSS (default: true) */
  standalone?: boolean;
  /**
   * Diagram rendering mode (HTML export only):
   * - "img": pre-render diagrams and embed as data: images (best for offline)
   * - "live": keep source blocks and render in the browser on load
   * - "none": do not process diagrams at all (keep source code blocks)
   */
  diagramMode?: 'img' | 'live' | 'none';
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
  }>;
  /**
   * When true, horizontal rules (---, ***, ___) will be converted to page breaks in print/PDF.
   * Note: this hides `<hr>` visually (default: false for HTML).
   */
  hrAsPageBreak?: boolean;
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
  mode: 'img' | 'live' | 'none'
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
    const decodedCode = decodeHtmlEntities(code);

    // Normalize language aliases to renderer types
    let renderType = lang.toLowerCase();
    if (renderType === 'graphviz' || renderType === 'gv') renderType = 'dot';
    if (renderType === 'vegalite') renderType = 'vega-lite';

    try {
      const result = await browserRenderer.render(renderType, decodedCode, basePath, themeConfig);
      if (result && result.base64) {
        const imgTag = `<div class="md2x-diagram"><img class="md2x-diagram" src="data:image/${result.format};base64,${result.base64}" alt="${escapeHtmlText(
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
  diagramMode: 'img' | 'live' | 'none'
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
  html = await processDiagrams(html, browserRenderer, basePath, themeConfig, diagramMode);

  return html;
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
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

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
      const pluginRenderer = createPluginRenderer(browserRenderer, basePath, themeConfig);

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
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
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
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

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

      // Process markdown to HTML (with diagram rendering)
      const html = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, 'img');

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
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
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

      const fragment = await markdownToHtmlFragment(markdown, browserRenderer, basePath, themeConfig, diagramMode);

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

      const cdnBaseDefaults = {
        mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.min.js',
        // Preferred: modern Graphviz WASM build (provides window.Viz.instance()).
        vizGlobal: 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3.24.0/dist/viz-global.js',
        // Legacy fallback (provides window.Viz constructor).
        viz: 'https://cdn.jsdelivr.net/npm/viz.js@2.1.2/viz.js',
        vizRender: 'https://cdn.jsdelivr.net/npm/viz.js@2.1.2/full.render.js',
        infographic: 'https://cdn.jsdelivr.net/npm/@antv/infographic@0.2.7/dist/infographic.min.js',
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

      const cdnOverrides = options.cdn ?? {};

      const liveBootstrap =
        diagramMode !== 'live'
          ? ''
          : `
  <!-- md2x live diagram renderer (CDN) -->
  <script>
  (function () {
    const themeConfig = ${JSON.stringify(themeConfig ?? null)};
    const baseHref = ${JSON.stringify(baseHref)};
    const cdnOverrides = ${JSON.stringify(cdnOverrides)};
    const cdnBaseDefaults = ${JSON.stringify(cdnBaseDefaults)};
    const cdnVegaDefaultsByMajor = ${JSON.stringify(cdnVegaDefaultsByMajor)};

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load script: ' + src));
        document.head.appendChild(s);
      });
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
      // Scan vega-lite blocks and pick a major version based on $schema.
      const blocks = Array.from(document.querySelectorAll('pre > code'));
      let detected = null;
      for (const codeEl of blocks) {
        const langRaw = getLangFromCodeClass(codeEl);
        const lang = normalizeLang(langRaw);
        if (lang !== 'vega-lite') continue;

        const text = (codeEl && codeEl.textContent) ? codeEl.textContent : '';
        if (!text.trim()) continue;

        // Prefer a regex scan first so we can still detect schema versions for
        // code blocks that aren't strictly valid JSON (e.g. trailing commas).
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
            // If any block is v6, prefer v6. Otherwise keep v5.
            if (major === 6) return 6;
          }
        } catch {
          // ignore parse errors
        }
      }
      return detected || 6;
    }

    async function ensureCdnLibsLoaded() {
      const major = detectVegaLiteMajorFromDocument();
      const vegaDefaults = cdnVegaDefaultsByMajor[String(major)] || cdnVegaDefaultsByMajor['6'];
      const cdn = Object.assign({}, cdnBaseDefaults, vegaDefaults, cdnOverrides || {});

      // Load order matters.
      await loadScript(cdn.mermaid);
      if (cdn.vizGlobal) {
        await loadScript(cdn.vizGlobal);
      } else {
        await loadScript(cdn.viz);
        await loadScript(cdn.vizRender);
      }
      await loadScript(cdn.vega);
      await loadScript(cdn.vegaLite);
      await loadScript(cdn.vegaEmbed);
      await loadScript(cdn.infographic);
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
      // Preferred: @viz-js/viz global build
      if (VizGlobal && typeof VizGlobal.instance === 'function') {
        const viz = await VizGlobal.instance();
        const svgEl = viz.renderSVGElement(code, { graphAttributes: { bgcolor: 'transparent' } });
        mount.appendChild(svgEl);
        return;
      }

      // Legacy: viz.js
      if (typeof window.Viz === 'function') {
        const viz = new window.Viz();
        const svgEl = await viz.renderSVGElement(code);
        mount.appendChild(svgEl);
      }
    }

    function applyDefaultVegaLiteSort(spec) {
      // If users mark a field as ordinal, a common expectation is "use the data order"
      // (e.g. '1月'...'12月'). Vega-Lite defaults to sorting discrete domains, which can
      // produce surprising orders for stringified numbers. We only change behavior
      // when the author hasn't specified an explicit sort.
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
      applyDefaultVegaLiteSort(spec);
      await vegaEmbed(mount, spec, {
        actions: false,
        renderer: 'svg',
        defaultStyle: true,
        logLevel: (window.vega && window.vega.Warn) ? window.vega.Warn : undefined,
      });
    }

    async function renderInfographic(code, mount) {
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

    async function main() {
      // Best-effort base href: some renderers may load assets relative to document.
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

      try {
        await ensureCdnLibsLoaded();
      } catch (e) {
        // If CDN scripts fail to load, keep code blocks as-is.
        return;
      }

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
          }
        } catch {
          // Keep original code block on error
        }
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
    } else {
      main();
    }
  })();
  </script>`;

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

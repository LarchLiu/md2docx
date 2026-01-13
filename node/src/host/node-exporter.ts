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
import { createBrowserRenderer, type BrowserRenderer, type PdfOptions } from './browser-renderer';
import { createNodePlatform } from './node-platform';
import { plugins } from '../../../src/plugins/index';
import type { PluginRenderer, RendererThemeConfig } from '../../../src/types/index';

export type Md2DocxOptions = {
  theme?: string;
  basePath?: string;
  /** When true, horizontal rules (---, ***, ___) will be converted to page breaks (default: true) */
  docxHrAsPageBreak?: boolean;
};

export type Md2PdfOptions = {
  theme?: string;
  basePath?: string;
  pdf?: PdfOptions;
  /** When true, horizontal rules (---, ***, ___) will be converted to page breaks */
  pdfHrAsPageBreak?: boolean;
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
      settings: {
        docxHrAsPageBreak: options.docxHrAsPageBreak ?? true,
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
      settings: {
        docxHrAsPageBreak: options.docxHrAsPageBreak ?? true,
      },
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
async function loadBaseCss(pdfHrAsPageBreak: boolean = true): Promise<string> {
  // Base styles for markdown rendering
  // When pdfHrAsPageBreak is true, hr elements will trigger page breaks
  const hrStyles = pdfHrAsPageBreak
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
  overflow: auto;
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
    const basePath = options.basePath || process.cwd();
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

      // Process markdown to HTML
      const html = await this.processMarkdownToHtml(markdown, browserRenderer, basePath, themeConfig);

      // Load CSS
      const baseCss = await loadBaseCss(options.pdfHrAsPageBreak ?? true);
      let themeCss = '';
      try {
        themeCss = await loadThemeCss(themeId);
      } catch (e) {
        console.warn('Failed to load theme CSS, using base styles only:', e);
      }
      const css = baseCss + '\n' + themeCss;

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

  /**
   * Export markdown file to PDF file
   */
  async exportToFile(inputPath: string, outputPath: string, options: Md2PdfOptions = {}): Promise<void> {
    ensureBase64Globals();

    const markdown = fs.readFileSync(inputPath, 'utf-8');
    const basePath = path.dirname(path.resolve(inputPath));

    const buffer = await this.exportToBuffer(markdown, {
      ...options,
      basePath,
    });

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, buffer);
  }

  /**
   * Process markdown to HTML with diagram rendering
   */
  private async processMarkdownToHtml(
    markdown: string,
    browserRenderer: BrowserRenderer,
    basePath: string,
    themeConfig: RendererThemeConfig
  ): Promise<string> {
    // Import markdown processor dynamically
    const { unified } = await import('unified');
    const remarkParse = (await import('remark-parse')).default;
    const remarkGfm = (await import('remark-gfm')).default;
    const remarkMath = (await import('remark-math')).default;
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
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeKatex)
      .use(rehypeHighlight)
      .use(rehypeBlockImages)
      .use(rehypeStringify, { allowDangerousHtml: true });

    // Process markdown
    const file = await processor.process(markdown);
    let html = String(file);

    // Process diagrams (mermaid, graphviz, vega-lite, etc.)
    html = await this.processDiagrams(html, browserRenderer, basePath, themeConfig);

    return html;
  }

  /**
   * Process diagram code blocks and replace with rendered images
   */
  private async processDiagrams(
    html: string,
    browserRenderer: BrowserRenderer,
    basePath: string,
    themeConfig: RendererThemeConfig
  ): Promise<string> {
    // Build supported languages from plugin system
    // Only include plugins that handle 'code' nodes (not 'html' or 'image' only)
    const pluginLangs = plugins
      .filter(p => p.nodeSelector.includes('code'))
      .map(p => p.language)
      .filter((lang): lang is string => lang !== null);

    // Add common aliases that plugins support via extractContent override
    const aliases = ['graphviz', 'gv', 'vegalite'];
    const supportedLangs = [...pluginLangs, ...aliases].join('|');

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
      const decodedCode = this.decodeHtmlEntities(code);

      // Normalize language aliases to renderer types
      let renderType = lang.toLowerCase();
      if (renderType === 'graphviz' || renderType === 'gv') renderType = 'dot';
      if (renderType === 'vegalite') renderType = 'vega-lite';

      try {
        const result = await browserRenderer.render(renderType, decodedCode, basePath, themeConfig);
        if (result && result.base64) {
          const imgTag = `<img src="data:image/${result.format};base64,${result.base64}" alt="${lang} diagram" style="max-width: 100%;" />`;
          html = html.replace(fullMatch, imgTag);
        }
      } catch (e) {
        console.warn(`Failed to render ${lang} diagram:`, e);
        // Keep original code block on error
      }
    }

    return html;
  }

  /**
   * Decode HTML entities in code blocks
   */
  private decodeHtmlEntities(text: string): string {
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
}

export default NodeDocxExporter;

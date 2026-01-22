/**
 * Core markdown conversion utilities - Web Worker compatible
 * No Node.js dependencies (fs, path, process)
 */

import * as yaml from 'js-yaml';
import { unified } from 'unified';
import * as themes from './themes-data';
import { templates as bundledTemplates } from './templates-data';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkSuperSub from '../../../src/plugins/remark-super-sub';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

// Re-export types
export type {
  OutputFormat,
  DiagramMode,
  FrontMatterData,
  ImageOptions,
  FrontMatterOptions,
  CdnOptions,
  MarkdownToHtmlStringOptions,
  RendererThemeConfig,
} from './types';

import type {
  OutputFormat,
  FrontMatterData,
  FrontMatterOptions,
  ImageOptions,
  CdnOptions,
  MarkdownToHtmlStringOptions,
  RendererThemeConfig,
} from './types';

// ============================================================================
// Front Matter Parsing
// ============================================================================

export function parseFrontMatter(markdown: string): { content: string; data: FrontMatterData; hasFrontMatter: boolean } {
  const md = String(markdown);
  const fmMatch = md.match(/^---\s*[\r\n]([\s\S]*?)[\r\n](?:---|\.\.\.)\s*(?:[\r\n]([\s\S]*))?$/);
  if (!fmMatch) {
    return { content: markdown, data: {}, hasFrontMatter: false };
  }

  try {
    const data = yaml.load(fmMatch[1]) as FrontMatterData;
    const content = fmMatch[2] || '';
    const hasFrontMatter = Object.keys(data).length > 0;
    return { content, data, hasFrontMatter };
  } catch {
    return { content: markdown, data: {}, hasFrontMatter: false };
  }
}

export function frontMatterToOptions(data: FrontMatterData): FrontMatterOptions {
  const out: FrontMatterOptions = {};

  if (typeof data.theme === 'string') out.theme = data.theme;
  if (typeof data.hrAsPageBreak === 'boolean') out.hrAsPageBreak = data.hrAsPageBreak;

  if (typeof data.format === 'string') {
    const fmt = data.format.toLowerCase();
    if (fmt === 'pdf' || fmt === 'docx' || fmt === 'html' || fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp') {
      out.format = fmt;
    }
  }

  if (data.image && typeof data.image === 'object') {
    const img = data.image as any;
    const image: ImageOptions = {};

    if (typeof img.type === 'string') {
      const t = img.type.toLowerCase();
      if (t === 'png' || t === 'jpeg' || t === 'webp') image.type = t;
      if (t === 'jpg') image.type = 'jpeg';
    }
    if (typeof img.quality === 'number' && Number.isFinite(img.quality)) image.quality = img.quality;
    if (typeof img.maxPixelWidth === 'number' && Number.isFinite(img.maxPixelWidth)) image.maxPixelWidth = img.maxPixelWidth;
    if (typeof img.split === 'boolean') image.split = img.split;
    else if (typeof img.split === 'string' && img.split.toLowerCase() === 'auto') image.split = 'auto';
    if (typeof img.splitMaxPixelHeight === 'number' && Number.isFinite(img.splitMaxPixelHeight)) image.splitMaxPixelHeight = img.splitMaxPixelHeight;
    if (typeof img.splitOverlapPx === 'number' && Number.isFinite(img.splitOverlapPx)) image.splitOverlapPx = img.splitOverlapPx;
    if (typeof img.fullPage === 'boolean') image.fullPage = img.fullPage;
    if (typeof img.selector === 'string') image.selector = img.selector;
    else if (Array.isArray(img.selector)) image.selector = img.selector.filter((s: unknown) => typeof s === 'string');
    if (typeof img.selectorMode === 'string') {
      const m = img.selectorMode.toLowerCase();
      if (m === 'first' || m === 'each' || m === 'union' || m === 'stitch') image.selectorMode = m;
    }
    if (typeof img.selectorPadding === 'number' && Number.isFinite(img.selectorPadding)) image.selectorPadding = img.selectorPadding;
    if (typeof img.selectorGap === 'number' && Number.isFinite(img.selectorGap)) image.selectorGap = img.selectorGap;
    if (typeof img.scrollToLoad === 'boolean') image.scrollToLoad = img.scrollToLoad;
    if (img.scroll && typeof img.scroll === 'object') {
      const s = img.scroll as any;
      const scroll: any = {};
      if (typeof s.stepPx === 'number' && Number.isFinite(s.stepPx)) scroll.stepPx = s.stepPx;
      if (typeof s.delayMs === 'number' && Number.isFinite(s.delayMs)) scroll.delayMs = s.delayMs;
      if (typeof s.maxSteps === 'number' && Number.isFinite(s.maxSteps)) scroll.maxSteps = s.maxSteps;
      if (typeof s.maxTimeMs === 'number' && Number.isFinite(s.maxTimeMs)) scroll.maxTimeMs = s.maxTimeMs;
      if (Object.keys(scroll).length > 0) image.scroll = scroll;
    }
    if (typeof img.omitBackground === 'boolean') image.omitBackground = img.omitBackground;
    if (typeof img.fromSurface === 'boolean') image.fromSurface = img.fromSurface;
    if (typeof img.captureBeyondViewport === 'boolean') image.captureBeyondViewport = img.captureBeyondViewport;
    if (img.viewport && typeof img.viewport === 'object') {
      const vp = img.viewport as any;
      const viewport: NonNullable<ImageOptions['viewport']> = {};
      if (typeof vp.width === 'number' && Number.isFinite(vp.width)) viewport.width = vp.width;
      if (typeof vp.height === 'number' && Number.isFinite(vp.height)) viewport.height = vp.height;
      if (typeof vp.deviceScaleFactor === 'number' && Number.isFinite(vp.deviceScaleFactor)) viewport.deviceScaleFactor = vp.deviceScaleFactor;
      if (Object.keys(viewport).length > 0) image.viewport = viewport;
    }

    if (Object.keys(image).length > 0) out.image = image;
  }

  if (typeof data.title === 'string') out.title = data.title;
  if (typeof data.standalone === 'boolean') out.standalone = data.standalone;
  if (typeof data.baseTag === 'boolean') out.baseTag = data.baseTag;
  if (typeof (data as any).liveRuntime === 'string') {
    const v = String((data as any).liveRuntime).toLowerCase();
    if (v === 'inline' || v === 'cdn') out.liveRuntime = v;
  }
  if (typeof (data as any).liveRuntimeBaseUrl === 'string') out.liveRuntimeBaseUrl = String((data as any).liveRuntimeBaseUrl);

  if (typeof data.diagramMode === 'string') {
    const dm = data.diagramMode.toLowerCase();
    if (dm === 'img' || dm === 'live' || dm === 'none') out.diagramMode = dm;
  }

  if (data.cdn && typeof data.cdn === 'object') out.cdn = data.cdn as Record<string, string>;
  if (data.templates && typeof data.templates === 'object' && !Array.isArray(data.templates)) {
    const templates: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.templates as Record<string, unknown>)) {
      if (typeof k === 'string' && typeof v === 'string') templates[k] = v;
    }
    if (Object.keys(templates).length > 0) out.templates = templates;
  }
  if (data.pdf && typeof data.pdf === 'object') out.pdf = data.pdf as Record<string, unknown>;

  return out;
}

// ============================================================================
// Format Utilities
// ============================================================================

export function formatToExtension(format: OutputFormat): string {
  switch (format) {
    case 'pdf': return '.pdf';
    case 'docx': return '.docx';
    case 'html': return '.html';
    case 'png': return '.png';
    case 'webp': return '.webp';
    case 'jpeg': return '.jpeg';
    case 'jpg': return '.jpg';
    default: return '.pdf';
  }
}

export function isImageFormat(format: OutputFormat): format is Extract<OutputFormat, 'png' | 'jpg' | 'jpeg' | 'webp'> {
  return format === 'png' || format === 'jpg' || format === 'jpeg' || format === 'webp';
}

export function normalizeImageType(format: Extract<OutputFormat, 'png' | 'jpg' | 'jpeg' | 'webp'>): 'png' | 'jpeg' | 'webp' {
  return format === 'jpg' ? 'jpeg' : format;
}

// ============================================================================
// Markdown to HTML Conversion (Web Worker compatible)
// ============================================================================

function rehypeBlockImages() {
  return (tree: any) => {
    visit(tree, 'element', (node: any) => {
      if (node.tagName !== 'p') return;
      const children = node.children || [];
      if (children.length === 0) return;

      let imageCount = 0, imageIndex = -1, hasTextAfter = false, foundImage = false;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === 'element' && child.tagName === 'img') {
          imageCount++; imageIndex = i; foundImage = true;
        } else if (foundImage) {
          if ((child.type === 'text' && child.value.trim()) || (child.type === 'element' && child.tagName !== 'br')) {
            hasTextAfter = true;
          }
        }
      }

      if (imageCount === 1 && !hasTextAfter && imageIndex >= 0) {
        const img = children[imageIndex];
        img.properties = img.properties || {};
        const cls = img.properties.className || [];
        img.properties.className = Array.isArray(cls) ? [...cls, 'block-image'] : [cls, 'block-image'];
      }
    });
  };
}

/**
 * Convert markdown to HTML fragment (Web Worker compatible)
 * No diagram processing - use diagramMode: 'live' or 'none' for browser-side rendering
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkSuperSub)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeHighlight)
    .use(rehypeBlockImages)
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = await processor.process(markdown);
  return String(file);
}

// ============================================================================
// Standalone HTML Generation (Web Worker compatible, CDN-based)
// ============================================================================

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert markdown to standalone HTML string (Web Worker compatible)
 * Uses CDN for KaTeX CSS - no file system access required
 */
export async function markdownToStandaloneHtml(
  markdown: string,
  options: MarkdownToHtmlStringOptions = {}
): Promise<string> {
  const fragment = await markdownToHtml(markdown);
  const title = options.title || 'Document';
  const katexVersion = options.katexVersion || '0.16.11';

  // Build themeConfig from theme (use provided or derive from theme)
  const themeConfig = options.themeConfig ?? (options.theme ? loadRendererThemeConfig(options.theme) : null);

  // Collect md2x template files from markdown (bundled templates + optional preloaded map).
  const md2xTemplateFiles = collectMd2xTemplateFilesFromMarkdown(markdown, options.md2xTemplateFiles);

  const liveBootstrap = options.liveDiagrams !== false
    ? buildLiveDiagramBootstrapCdn(detectLiveRenderTypes(fragment), {
        ...options.cdn,
        baseHref: options.baseHref,
        themeConfig,
        md2xTemplateFiles,
      })
    : '';

  const baseCss = loadBaseCss(options.hrAsPageBreak ?? false);
  const themeCss = options.theme ? loadThemeCss(options.theme) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexVersion}/dist/katex.min.css" crossorigin="anonymous">
${options.head || ''}  <style>
${baseCss}
${themeCss}
${options.css || ''}
  </style>
</head>
<body>
  <div id="markdown-content" class="markdown-body">${fragment}</div>
${liveBootstrap}
</body>
</html>`;
}

// ============================================================================
// Live Diagram Bootstrap (CDN-only, Web Worker compatible)
// ============================================================================

/**
 * Collect md2x template files from markdown (uses bundled templates + optional pre-loaded templates map)
 */
export function collectMd2xTemplateFilesFromMarkdown(
  markdown: string,
  templates?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  const files = templates ?? {};

  const extractQuoted = (text: string, key: string): string => {
    // Best-effort: `key: 'value'` / `key: "value"` (usually single-line).
    // Note: intentionally does not support template literals to avoid escaping issues and surprises.
    const m = String(text || '').match(new RegExp(`\\b${key}\\s*:\\s*(['"])([^\\n\\r]*?)\\1`, 'i'));
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

  // Match fenced md2x blocks:
  // ```md2x
  // ...
  // ```
  const fenceRegex = /```md2x[^\n\r]*[\r\n]([\s\S]*?)```/gi;
  const matches = [...String(markdown || '').matchAll(fenceRegex)];

  for (const match of matches) {
    const code = String(match[1] ?? '');
    const typeRef = extractQuoted(code, 'type');
    const templateRaw = extractQuoted(code, 'template');
    const templateRef = normalizeMd2xTemplateRef(typeRef, templateRaw);
    if (!templateRef) continue;

    const fromProvided =
      (typeof files[templateRef] === 'string' ? files[templateRef] : undefined) ??
      (templateRaw && typeof files[templateRaw] === 'string' ? files[templateRaw] : undefined);
    const fromBundled = bundledTemplates[templateRef];
    const content = typeof fromProvided === 'string' ? fromProvided : fromBundled;
    if (!content) continue;

    out[templateRef] = content;
    if (templateRaw) out[templateRaw] = content;
  }

  return out;
}

/**
 * Detect diagram types from HTML content
 */
export function detectLiveRenderTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /\blanguage-([a-z0-9-]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let t = String(m[1] || '').toLowerCase();
    if (t === 'graphviz' || t === 'gv') t = 'dot';
    if (t === 'vegalite') t = 'vega-lite';
    if (t) types.add(t);
  }
  return Array.from(types);
}

interface LiveBootstrapOptions extends CdnOptions {
  baseHref?: string;
  themeConfig?: RendererThemeConfig | null;
  md2xTemplateFiles?: Record<string, string>;
}

const CHUNK_BY_TYPE: Record<string, string> = {
  mermaid: 'live-runtime-mermaid.js',
  dot: 'live-runtime-dot.js',
  vega: 'live-runtime-vega.js',
  'vega-lite': 'live-runtime-vega.js',
  infographic: 'live-runtime-infographic.js',
  canvas: 'live-runtime-canvas.js',
  html: 'live-runtime-html.js',
  svg: 'live-runtime-svg.js',
  md2x: 'live-runtime-md2x.js',
};

/**
 * Get live runtime chunk filenames for given render types
 */
export function liveRuntimeChunks(types: string[]): string[] {
  const chunks = new Set<string>();
  for (const t of types) {
    const name = CHUNK_BY_TYPE[String(t || '').trim().toLowerCase()];
    if (name) chunks.add(name);
  }
  return Array.from(chunks);
}

/**
 * Build live diagram bootstrap script (CDN-only version)
 * Web Worker compatible - no file system access
 */
export function buildLiveDiagramBootstrapCdn(
  requiredRenderTypes: string[],
  options: LiveBootstrapOptions = {}
): string {
  const md2xVersion = options.md2xVersion || 'latest';
  const baseUrl = options.runtimeBaseUrl || `https://cdn.jsdelivr.net/npm/md2x@${md2xVersion}/dist/renderer/`;
  const mermaidSrc = options.mermaidUrl || 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

  const chunks = liveRuntimeChunks(requiredRenderTypes);
  const needMermaid = chunks.includes('live-runtime-mermaid.js');
  const coreUrl = new URL('live-runtime-core.js', baseUrl).href;
  const chunkTags = Array.from(chunks)
    .sort()
    .map((name) => `  <script src="${escapeHtml(new URL(name, baseUrl).href)}"></script>`)
    .join('\n');

  const optsJson = JSON.stringify({
    baseHref: options.baseHref || '',
    themeConfig: options.themeConfig ?? null,
    md2xTemplateFiles: options.md2xTemplateFiles ?? {},
    cdn: options.cdn ?? {},
    rootSelector: '#markdown-content',
  }).replace(/</g, '\\u003c');

  return `
  <!-- md2x live diagram renderer (CDN) -->
  <script>try { window.__md2xLiveDone = false; } catch {}</script>
${needMermaid ? `  <script src="${escapeHtml(mermaidSrc)}"></script>\n` : ''}  <script src="${escapeHtml(coreUrl)}"></script>
${chunkTags}
  <script>
  (function () {
    const opts = ${optsJson};
    function run() {
      const fn = window.__md2xRenderDocument;
      if (typeof fn === 'function') {
        fn(opts).catch(() => { try { window.__md2xLiveDone = true; } catch {} });
      } else {
        try { window.__md2xLiveDone = true; } catch {}
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  })();
  </script>`;
}

// ============================================================================
// Theme CSS Generation (Synchronous, Web Worker compatible)
// ============================================================================

type FontConfigFile = typeof themes.fontConfig;

function buildFontFamily(fontName: string): string {
  const font = (themes.fontConfig as FontConfigFile).fonts[fontName as keyof FontConfigFile['fonts']];
  return font?.webFallback || fontName;
}

function ptToPx(ptSize: string): string {
  const pt = parseFloat(ptSize);
  return `${pt * 4 / 3}px`;
}

function getThemeData(themeId: string) {
  const key = `presets_${themeId.replace(/-/g, '_')}` as keyof typeof themes;
  return themes[key] as any;
}

function getLayoutScheme(id: string) {
  const key = `layout_schemes_${id.replace(/-/g, '_')}` as keyof typeof themes;
  return themes[key] as any;
}

function getColorScheme(id: string) {
  const key = `color_schemes_${id.replace(/-/g, '_')}` as keyof typeof themes;
  return themes[key] as any;
}

function getTableStyle(id: string) {
  const key = `table_styles_${id.replace(/-/g, '_')}` as keyof typeof themes;
  return themes[key] as any;
}

function getCodeTheme(id: string) {
  const key = `code_themes_${id.replace(/-/g, '_')}` as keyof typeof themes;
  return themes[key] as any;
}

/**
 * Load renderer theme config from theme data (synchronous)
 */
export function loadRendererThemeConfig(themeId: string): RendererThemeConfig {
  const preset = getThemeData(themeId);
  if (!preset) return {};
  const layoutScheme = getLayoutScheme(preset.layoutScheme);
  const fontFamily = preset?.fontScheme?.body?.fontFamily;
  const fontSize = layoutScheme?.body?.fontSize ? parseFloat(layoutScheme.body.fontSize) : undefined;
  return {
    fontFamily: typeof fontFamily === 'string' ? buildFontFamily(fontFamily) : undefined,
    fontSize: typeof fontSize === 'number' && Number.isFinite(fontSize) ? fontSize : undefined,
    diagramStyle: preset?.diagramStyle,
    background: preset?.page?.background,
    foreground: preset?.page?.foreground,
  };
}

/**
 * Generate theme CSS from theme data (synchronous)
 */
export function loadThemeCss(themeId: string): string {
  const theme = getThemeData(themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);

  const layoutScheme = getLayoutScheme(theme.layoutScheme);
  const colorScheme = getColorScheme(theme.colorScheme);
  const tableStyle = getTableStyle(theme.tableStyle);
  const codeTheme = getCodeTheme(theme.codeTheme);

  const css: string[] = [];

  // Body styles
  const bodyFontFamily = buildFontFamily(theme.fontScheme.body.fontFamily);
  const bodyFontSize = ptToPx(layoutScheme.body.fontSize);
  css.push(`#markdown-content {
  font-family: ${bodyFontFamily};
  font-size: ${bodyFontSize};
  line-height: ${layoutScheme.body.lineHeight};
  color: ${colorScheme.text.primary};
}`);

  // Links
  css.push(`#markdown-content a { color: ${colorScheme.accent.link}; }
#markdown-content a:hover { color: ${colorScheme.accent.linkHover}; }`);

  // KaTeX
  css.push(`.katex { font-size: ${bodyFontSize}; }`);

  // Headings
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    const fontHeading = theme.fontScheme.headings[level] as any;
    const layoutHeading = layoutScheme.headings[level];
    const fontFamily = buildFontFamily(fontHeading?.fontFamily || theme.fontScheme.headings.fontFamily || theme.fontScheme.body.fontFamily);
    const fontWeight = fontHeading?.fontWeight || theme.fontScheme.headings.fontWeight || 'bold';
    const headingColor = colorScheme.headings?.[level] || colorScheme.text.primary;

    const styles = [
      `font-family: ${fontFamily}`,
      `font-size: ${ptToPx(layoutHeading.fontSize)}`,
      `font-weight: ${fontWeight}`,
      `color: ${headingColor}`
    ];
    if (layoutHeading.alignment && layoutHeading.alignment !== 'left') styles.push(`text-align: ${layoutHeading.alignment}`);
    if (layoutHeading.spacingBefore && layoutHeading.spacingBefore !== '0pt') styles.push(`margin-top: ${ptToPx(layoutHeading.spacingBefore)}`);
    if (layoutHeading.spacingAfter && layoutHeading.spacingAfter !== '0pt') styles.push(`margin-bottom: ${ptToPx(layoutHeading.spacingAfter)}`);

    css.push(`#markdown-content ${level} { ${styles.join('; ')}; }`);
  }

  // Table styles
  css.push(`#markdown-content table { border-collapse: collapse; margin: 13px auto; overflow: auto; }`);
  const borderColor = colorScheme.table.border;
  const border = tableStyle.border || {};

  css.push(`#markdown-content table th, #markdown-content table td { padding: ${tableStyle.cell.padding}; }`);

  if (border.all) {
    const w = border.all.width.replace('pt', 'px');
    css.push(`#markdown-content table th, #markdown-content table td { border: ${w} solid ${borderColor}; }`);
  } else {
    css.push(`#markdown-content table th, #markdown-content table td { border: none; }`);
    if (border.headerTop) css.push(`#markdown-content table th { border-top: ${border.headerTop.width.replace('pt', 'px')} solid ${borderColor}; }`);
    if (border.headerBottom) css.push(`#markdown-content table th { border-bottom: ${border.headerBottom.width.replace('pt', 'px')} solid ${borderColor}; }`);
    if (border.rowBottom) css.push(`#markdown-content table td { border-bottom: ${border.rowBottom.width.replace('pt', 'px')} solid ${borderColor}; }`);
    if (border.lastRowBottom) css.push(`#markdown-content table tr:last-child td { border-bottom: ${border.lastRowBottom.width.replace('pt', 'px')} solid ${borderColor}; }`);
  }

  css.push(`#markdown-content table th { background-color: ${colorScheme.table.headerBackground}; color: ${colorScheme.table.headerText}; font-weight: ${tableStyle.header.fontWeight || 'bold'}; }`);

  if (tableStyle.zebra?.enabled) {
    css.push(`#markdown-content table tr:nth-child(even) { background-color: ${colorScheme.table.zebraEven}; }`);
    css.push(`#markdown-content table tr:nth-child(odd) { background-color: ${colorScheme.table.zebraOdd}; }`);
  }

  // Code styles
  const codeFontFamily = buildFontFamily(theme.fontScheme.code.fontFamily);
  const codeFontSize = ptToPx(layoutScheme.code.fontSize);
  const codeBackground = colorScheme.background.code;

  css.push(`#markdown-content code { font-family: ${codeFontFamily}; font-size: ${codeFontSize}; background-color: ${codeBackground}; }`);
  css.push(`#markdown-content pre { background-color: ${codeBackground}; }`);
  css.push(`#markdown-content pre code { font-family: ${codeFontFamily}; font-size: ${codeFontSize}; background-color: transparent; }`);
  css.push(`#markdown-content .hljs { background: ${codeBackground} !important; color: ${codeTheme.foreground}; }`);

  for (const [token, color] of Object.entries(codeTheme.colors)) {
    css.push(`#markdown-content .hljs-${token} { color: ${color}; }`);
  }

  // Block spacing
  const blocks = layoutScheme.blocks;
  const toPx = (pt: string | undefined) => (!pt || pt === '0pt') ? '0' : ptToPx(pt);

  if (blocks.paragraph) css.push(`#markdown-content p { margin: ${toPx(blocks.paragraph.spacingBefore)} 0 ${toPx(blocks.paragraph.spacingAfter)} 0; }`);
  if (blocks.list) css.push(`#markdown-content ul, #markdown-content ol { margin: ${toPx(blocks.list.spacingBefore)} 0 ${toPx(blocks.list.spacingAfter)} 0; }`);
  if (blocks.listItem) css.push(`#markdown-content li { margin: ${toPx(blocks.listItem.spacingBefore)} 0 ${toPx(blocks.listItem.spacingAfter)} 0; }`);
  if (blocks.blockquote) css.push(`#markdown-content blockquote { margin: ${toPx(blocks.blockquote.spacingBefore)} 0 ${toPx(blocks.blockquote.spacingAfter)} 0; padding: ${toPx(blocks.blockquote.paddingVertical)} ${toPx(blocks.blockquote.paddingHorizontal)}; border-left-color: ${colorScheme.blockquote.border}; }`);
  if (blocks.codeBlock) css.push(`#markdown-content pre { margin: ${toPx(blocks.codeBlock.spacingBefore)} 0 ${toPx(blocks.codeBlock.spacingAfter)} 0; }`);
  if (blocks.table) css.push(`#markdown-content table { margin: ${toPx(blocks.table.spacingBefore)} auto ${toPx(blocks.table.spacingAfter)} auto; }`);
  if (blocks.horizontalRule) css.push(`#markdown-content hr { margin: ${toPx(blocks.horizontalRule.spacingBefore)} 0 ${toPx(blocks.horizontalRule.spacingAfter)} 0; }`);

  return css.join('\n');
}

/**
 * Generate base CSS styles (synchronous)
 */
export function loadBaseCss(hrAsPageBreak: boolean = true): string {
  const hrStyles = hrAsPageBreak
    ? `hr { height: 0; padding: 0; margin: 0; background-color: transparent; border: 0; page-break-after: always; break-after: page; visibility: hidden; }`
    : `hr { height: 0.25em; padding: 0; margin: 24px 0; background-color: #e1e4e8; border: 0; }`;

  return `* { box-sizing: border-box; }
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
.markdown-body, #markdown-content { max-width: 100%; padding: 20px; }
#markdown-content > div[style*="width"] { transform-origin: top left; break-inside: avoid; page-break-inside: avoid; }
h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #6a737d; }
p { margin-top: 0; margin-bottom: 16px; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
li { margin-bottom: 4px; }
li + li { margin-top: 4px; }
code { padding: 0.2em 0.4em; margin: 0; font-size: 85%; background-color: rgba(27, 31, 35, 0.05); border-radius: 3px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
pre { padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-size: 85%; line-height: 1.45; background-color: #f6f8fa; border-radius: 3px; margin-top: 0; margin-bottom: 16px; }
pre code { padding: 0; margin: 0; font-size: 100%; background-color: transparent; border: 0; white-space: inherit; overflow-wrap: inherit; word-break: inherit; }
blockquote { padding: 0 1em; color: #6a737d; border-left: 0.25em solid #dfe2e5; margin: 0 0 16px 0; }
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }
table { border-collapse: collapse; border-spacing: 0; margin-top: 0; margin-bottom: 16px; width: auto; }
th, td { padding: 6px 13px; border: 1px solid #dfe2e5; }
th { font-weight: 600; background-color: #f6f8fa; }
tr:nth-child(2n) { background-color: #f6f8fa; }
img { max-width: 100%; height: auto; box-sizing: content-box; }
.md2x-diagram { text-align: center; break-inside: avoid; page-break-inside: avoid; }
.md2x-diagram .md2x-diagram-inner { display: inline-block; max-width: 100%; text-align: left; }
.md2x-diagram .md2x-diagram-mount { display: inline-block; max-width: 100%; }
.md2x-diagram .vega-embed { display: inline-block; max-width: 100%; width: auto !important; }
.md2x-diagram .md2x-diagram-inner svg, .md2x-diagram .md2x-diagram-inner > svg { display: block; margin-left: auto; margin-right: auto; max-width: 100%; }
.md2x-diagram img, img.md2x-diagram { display: block; max-width: 100%; height: auto; margin-left: auto; margin-right: auto; break-inside: avoid; page-break-inside: avoid; }
#markdown-content svg { display: block; margin-left: auto; margin-right: auto; break-inside: avoid; page-break-inside: avoid; }
img.block-image { display: block; margin: 16px 0; }
.task-list-item { list-style-type: none; }
.task-list-item input { margin: 0 0.2em 0.25em -1.6em; vertical-align: middle; }
.katex { font-size: 1.1em; }
.katex-display { margin: 1em 0; overflow-x: auto; overflow-y: hidden; }
.hljs { display: block; overflow-x: auto; color: #24292e; background: #f6f8fa; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #d73a49; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #005cc5; }
.hljs-string, .hljs-doctag { color: #032f62; }
.hljs-title, .hljs-section, .hljs-selector-id { color: #6f42c1; font-weight: bold; }
.hljs-type, .hljs-class .hljs-title { color: #6f42c1; }
.hljs-tag, .hljs-name, .hljs-attribute { color: #22863a; }
.hljs-regexp, .hljs-link { color: #032f62; }
.hljs-symbol, .hljs-bullet { color: #e36209; }
.hljs-built_in, .hljs-builtin-name { color: #005cc5; }
.hljs-meta { color: #6a737d; font-weight: bold; }
.hljs-deletion { color: #b31d28; background-color: #ffeef0; }
.hljs-addition { color: #22863a; background-color: #f0fff4; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
${hrStyles}`;
}

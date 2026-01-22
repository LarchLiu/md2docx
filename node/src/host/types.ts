/**
 * Core types for markdown conversion - Web Worker compatible
 */

import type { RendererThemeConfig } from '../../../src/types/index';

export type { RendererThemeConfig };

// ============================================================================
// Core Types
// ============================================================================

export type OutputFormat = 'docx' | 'pdf' | 'html' | 'png' | 'jpg' | 'jpeg' | 'webp';
export type DiagramMode = 'img' | 'live' | 'none';
export type FrontMatterData = Record<string, unknown>;

// ============================================================================
// Image Options (shared by browser-renderer and node-exporter)
// ============================================================================

export interface ImageOptions {
  /** Output image type (default: "png") */
  type?: 'png' | 'jpeg' | 'webp';
  /** Image quality, 0-100 (only for jpeg/webp) */
  quality?: number;
  /**
   * Clamp the output bitmap width (in physical pixels) by lowering the deviceScaleFactor.
   * Default: 2000. Set to 0 to disable.
   */
  maxPixelWidth?: number;
  /**
   * Split very tall pages into multiple images.
   * - `false`: always export a single image
   * - `true`: always split when `fullPage: true`
   * - `"auto"` (default): split only when the page is too tall
   */
  split?: boolean | 'auto';
  /** Maximum slice height in physical pixels (default: 14000) */
  splitMaxPixelHeight?: number;
  /** Overlap between slices in CSS px (default: 0) */
  splitOverlapPx?: number;
  /** Capture the full scrollable page (default: true) */
  fullPage?: boolean;
  /** Capture a specific element instead of the full page (CSS selector) */
  selector?: string | string[];
  /** How to handle selectors that match multiple elements */
  selectorMode?: 'first' | 'each' | 'union' | 'stitch';
  /** Extra padding (CSS px) around the selected element */
  selectorPadding?: number;
  /** Vertical gap (CSS px) between elements when `selectorMode: "stitch"` */
  selectorGap?: number;
  /** Pre-scroll the page to trigger lazy-loading before taking a screenshot */
  scrollToLoad?: boolean;
  /** Fine-tune the scroll behavior when `scrollToLoad` is enabled */
  scroll?: { stepPx?: number; delayMs?: number; maxSteps?: number; maxTimeMs?: number };
  /** Omit the default white background (PNG only; default: false) */
  omitBackground?: boolean;
  /** Capture screenshot from the surface (GPU composited) or the view */
  fromSurface?: boolean;
  /** Capture beyond viewport setting */
  captureBeyondViewport?: boolean;
  /** Viewport settings */
  viewport?: { width?: number; height?: number; deviceScaleFactor?: number };
}

// ============================================================================
// PDF Options
// ============================================================================

export interface PdfOptions {
  format?: 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5';
  landscape?: boolean;
  margin?: {
    top?: string | number;
    bottom?: string | number;
    left?: string | number;
    right?: string | number;
  };
  printBackground?: boolean;
  scale?: number;
  displayHeaderFooter?: boolean;
  /** HTML template for the print header */
  headerTemplate?: string;
  /** HTML template for the print footer */
  footerTemplate?: string;
  /** Custom page width (e.g., '800px') */
  width?: string;
  /** Custom page height (e.g., '600px') */
  height?: string;
  /** Document title for header template */
  title?: string;
}

// ============================================================================
// Front Matter Options
// ============================================================================

export interface FrontMatterOptions {
  theme?: string;
  format?: OutputFormat;
  hrAsPageBreak?: boolean;
  image?: ImageOptions;
  title?: string;
  standalone?: boolean;
  diagramMode?: DiagramMode;
  baseTag?: boolean;
  liveRuntime?: 'inline' | 'cdn';
  liveRuntimeBaseUrl?: string;
  cdn?: Partial<{
    mermaid: string;
    vue: string;
    vueSfcLoader: string;
    svelteCompiler: string;
    svelteBase: string;
  }>;
  /**
   * Pre-loaded md2x template sources, keyed by template ref.
   *
   * Common keys:
   * - "vue/my-component.vue"
   * - "svelte/my-widget.svelte"
   * - "html/my-template.html"
   *
   * You may also include the raw `template:` value (e.g. "my-component.vue") as an additional key.
   */
  templates?: Record<string, string>;
  pdf?: PdfOptions;
}

// ============================================================================
// CDN Options
// ============================================================================

export interface CdnOptions {
  /** CDN base URL for md2x runtime (default: jsdelivr) */
  runtimeBaseUrl?: string;
  /** Mermaid CDN URL */
  mermaidUrl?: string;
  /** md2x package version for CDN */
  md2xVersion?: string;
  /** CDN overrides for diagram libraries */
  cdn?: Partial<{
    mermaid: string;
    vue: string;
    vueSfcLoader: string;
    svelteCompiler: string;
    svelteBase: string;
  }>;
}

// ============================================================================
// Markdown to HTML Options
// ============================================================================

export interface MarkdownToHtmlStringOptions {
  title?: string;
  /** Theme ID (e.g., 'default', 'academic') */
  theme?: string;
  /** KaTeX version for CDN */
  katexVersion?: string;
  /** Additional CSS to inject */
  css?: string;
  /** Additional head content (e.g., custom stylesheets) */
  head?: string;
  /** Enable live diagram rendering (mermaid, graphviz, etc.) */
  liveDiagrams?: boolean;
  /** CDN URL options */
  cdn?: CdnOptions;
  /** Treat hr as page break */
  hrAsPageBreak?: boolean;
  /** Base href for resolving relative URLs */
  baseHref?: string;
  /** Theme config for renderers */
  themeConfig?: RendererThemeConfig | null;
  /** Pre-loaded md2x template files */
  md2xTemplateFiles?: Record<string, string>;
}

// ============================================================================
// Browser Renderer Types
// ============================================================================

export interface RenderResult {
  base64: string;
  width: number;
  height: number;
  format: string;
}

export interface BrowserRenderer {
  initialize(): Promise<void>;
  render(type: string, content: string | object, basePath?: string, themeConfig?: RendererThemeConfig | null): Promise<RenderResult | null>;
  exportToPdf(html: string, css: string, options?: PdfOptions, basePath?: string): Promise<Buffer>;
  exportToImage(html: string, css: string, options?: ImageOptions, basePath?: string): Promise<Buffer>;
  exportToImageParts(html: string, css: string, options?: ImageOptions, basePath?: string): Promise<Buffer[]>;
  close(): Promise<void>;
}

// ============================================================================
// Node Exporter Types
// ============================================================================

export interface Md2xTemplateConfig {
  template: string;
  type: 'vue' | 'html' | 'svelte';
  data: any;
}

export interface Md2xBaseOptions {
  theme?: string;
  basePath?: string;
  /** When true, horizontal rules will be converted to page breaks in print/PDF */
  hrAsPageBreak?: boolean;
  /** Diagram/template rendering mode: "img" | "live" | "none" */
  diagramMode?: DiagramMode;
  /** Pre-loaded md2x template sources */
  templates?: Record<string, string>;
}

export interface Md2DocxOptions extends Md2xBaseOptions {}

export interface Md2PdfOptions extends Md2xBaseOptions {
  pdf?: PdfOptions;
  /** CDN overrides for live mode */
  cdn?: Md2HtmlOptions['cdn'];
}

export interface Md2ImageOptions extends Md2xBaseOptions {
  image?: ImageOptions;
  /** CDN overrides for live diagram mode */
  cdn?: Md2HtmlOptions['cdn'];
}

export interface Md2HtmlOptions extends Md2xBaseOptions {
  /** Document title for standalone HTML output */
  title?: string;
  /** When true, returns a full HTML document with embedded CSS (default: true) */
  standalone?: boolean;
  /** Live diagram runtime injection strategy: "inline" | "cdn" */
  liveRuntime?: 'inline' | 'cdn';
  /** Custom runtime base URL when `liveRuntime: "cdn"` */
  liveRuntimeBaseUrl?: string;
  /** Optional CDN overrides */
  cdn?: Partial<{
    mermaid: string;
    vue: string;
    vueSfcLoader: string;
    svelteCompiler: string;
    svelteBase: string;
  }>;
  /** When true, emit a `<base href="file://.../">` tag (default: true) */
  baseTag?: boolean;
}

// ============================================================================
// Node Platform Types
// ============================================================================

export type NodePlatformOutput =
  | { kind: 'buffer' }
  | { kind: 'file' };

export interface CreateNodePlatformOptions {
  /** Directory of the running Node module */
  moduleDir: string;
  selectedThemeId: string;
  output: NodePlatformOutput;
  /** Settings to pass to exporters via storage */
  settings?: {
    docxHrAsPageBreak?: boolean;
  };
}

export interface CreatedNodePlatform {
  platform: import('../../../src/types/index').PlatformAPI;
  getCapturedBuffer: () => Buffer | null;
}

// ============================================================================
// Convert API Types
// ============================================================================

/** Alias for FrontMatterOptions, used as conversion options */
export type ConvertOptions = FrontMatterOptions & {
  basePath?: string;
  /** Skip front matter parsing (use when markdown is already stripped of front matter) */
  skipFrontMatter?: boolean;
};

export interface ConvertResult {
  /** Output buffer */
  buffer: Buffer;
  /** Resolved output path */
  outputPath: string;
  /** Multiple parts for image format with splitting enabled */
  buffers?: Buffer[];
  outputPaths?: string[];
  /** Output format used */
  format: OutputFormat;
}

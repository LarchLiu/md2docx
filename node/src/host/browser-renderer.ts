/**
 * Browser-based Renderer for Node (Puppeteer)
 *
 * Refactored to reuse the shared render-worker-core + renderers (same as VSCode/mobile),
 * instead of inlining renderer implementations and loading CDN dependencies.
 *
 * The browser page is built by `node/build.mjs` into `node/dist/renderer/puppeteer-render.html`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { RendererThemeConfig } from '../../../src/types/index';

// Helper to get module directory - uses global set by entry point, or falls back to import.meta.url
function getModuleDir(): string {
  if ((globalThis as any).__md2x_module_dir__) {
    return (globalThis as any).__md2x_module_dir__;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

// Dynamic import for puppeteer (optional dependency)
let puppeteer: typeof import('puppeteer') | null = null;

export interface RenderResult {
  base64: string;
  width: number;
  height: number;
  format: string;
}

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
  /**
   * HTML template for the print header. Supports special classes:
   * - `<span class="date"></span>` - Current date
   * - `<span class="title"></span>` - Document title
   * - `<span class="url"></span>` - Document URL
   * - `<span class="pageNumber"></span>` - Current page number
   * - `<span class="totalPages"></span>` - Total pages
   *
   * Note: Must set font-size explicitly (e.g., `font-size: 10px`), otherwise text may be invisible.
   */
  headerTemplate?: string;
  /**
   * HTML template for the print footer. Supports the same special classes as headerTemplate.
   *
   * @example
   * ```yaml
   * pdf:
   *   displayHeaderFooter: true
   *   headerTemplate: '<div style="font-size:10px;width:100%;text-align:center;"><span class="title"></span></div>'
   *   footerTemplate: '<div style="font-size:10px;width:100%;text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'
   * ```
   */
  footerTemplate?: string;
  /** Custom page width (e.g., '800px'). Overrides format when specified with height. */
  width?: string;
  /** Custom page height (e.g., '600px'). Overrides format when specified with width. */
  height?: string;
  /** Document title for header template's `<span class="title"></span>` */
  title?: string;
}

export interface ImageOptions {
  /** Output image type (default: "png") */
  type?: 'png' | 'jpeg' | 'webp';
  /**
   * Clamp the output bitmap width (in physical pixels) by lowering the deviceScaleFactor.
   * This does NOT change layout (CSS pixels), only the exported image resolution.
   *
   * Default: 2000
   * Set to 0 to disable.
   */
  maxPixelWidth?: number;
  /**
   * Split very tall pages into multiple images to avoid Chrome/Skia limits and repeated tiles.
   *
   * - `false`: always export a single image
   * - `true`: always split when `fullPage: true` (unless `selector` is set)
   * - `"auto"` (default): split only when the page is too tall for a single reliable capture
   */
  split?: boolean | 'auto';
  /**
   * Maximum slice height in physical pixels (default: 14000).
   * Only used when `split` is enabled.
   */
  splitMaxPixelHeight?: number;
  /**
   * Overlap between slices in CSS px (default: 0).
   * Set > 0 if you need extra safety for boundary rendering (at the cost of repeated content).
   * Only used when `split` is enabled.
   */
  splitOverlapPx?: number;
  /**
   * When `fullPage: true`, Puppeteer can capture content outside the viewport in two ways:
   * - `captureBeyondViewport: true`: ask Chrome to capture beyond viewport (can be fast, but some very tall pages may repeat tiles)
   * - `captureBeyondViewport: false`: Puppeteer temporarily resizes the viewport to the full scroll size (more reliable for very tall pages)
   *
   * Default:
   * - when `selector` is set: true
   * - otherwise: false
   */
  captureBeyondViewport?: boolean;
  /**
   * Image quality, 0-100 (only for jpeg/webp).
   * If omitted, Puppeteer/Chromium defaults are used.
   */
  quality?: number;
  /** Capture the full scrollable page (default: true) */
  fullPage?: boolean;
  /**
   * Capture a specific element instead of the full page (CSS selector).
   * When provided, `fullPage` is ignored and the screenshot will be clipped to the element box.
   *
   * Example: `#markdown-content`
   */
  selector?: string | string[];
  /**
   * How to handle selectors that match multiple elements:
   *
   * Note: when `selector` matches multiple elements, "union" will include the in-between page content,
   * while "stitch" produces a clean "gallery" image containing only the matched elements.
   * - "union": capture the union bounding box of all matches (includes content between them)
   * - "each": capture each matched element separately (returns multiple parts)
   * - "first": capture only the first matched element
   * - "stitch": move all matched elements into a temporary container stacked vertically, capture that container, then restore
   */
  selectorMode?: 'first' | 'each' | 'union' | 'stitch';
  /**
   * Extra padding (CSS px) around the selected element when using `selector`.
   * Default: 0
   */
  selectorPadding?: number;
  /**
   * Vertical gap (CSS px) between elements when `selectorMode: "stitch"`.
   * Default: 0
   */
  selectorGap?: number;
  /**
   * Pre-scroll the page to trigger lazy-loading before taking a screenshot.
   * Useful for pages that only load images when they enter the viewport.
   *
   * Default:
   * - when `selector` is set: false
   * - otherwise: same as `fullPage` (true unless `fullPage: false`)
   */
  scrollToLoad?: boolean;
  /** Fine-tune the scroll behavior when `scrollToLoad` is enabled. */
  scroll?: Partial<{
    /** Scroll step in px (default: ~0.85 * viewport height) */
    stepPx: number;
    /** Delay between scroll steps (default: 250ms) */
    delayMs: number;
    /** Max number of scroll steps (default: 40) */
    maxSteps: number;
    /** Max total scroll time (default: 10000ms) */
    maxTimeMs: number;
  }>;
  /** Omit the default white background (PNG only; default: false) */
  omitBackground?: boolean;
  /**
   * Capture screenshot from the surface (GPU composited) or the view.
   * Some extremely tall pages can produce repeated tiles when capturing from surface;
   * setting this to `false` can help.
   *
   * Default: Puppeteer/Chromium default
   *
   * Note: when exporting extremely tall pages, forcing `fromSurface: false` may fail with
   * `Protocol error (Page.captureScreenshot): Unable to capture screenshot`. In that case,
   * keep it unset (default) or pair it with `captureBeyondViewport: false` for shorter pages.
   */
  fromSurface?: boolean;
  viewport?: {
    /** Viewport width in CSS pixels (default: 1200) */
    width?: number;
    /** Viewport height in CSS pixels (default: 800) */
    height?: number;
    /** Device scale factor (default: 1) */
    deviceScaleFactor?: number;
  };
}

function normalizeSelector(selector: ImageOptions['selector']): string | null {
  if (typeof selector === 'string') {
    const s = selector.trim();
    return s ? s : null;
  }
  if (Array.isArray(selector)) {
    const parts = selector
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

export interface BrowserRenderer {
  initialize(): Promise<void>;
  render(type: string, content: string | object, basePath?: string, themeConfig?: RendererThemeConfig | null): Promise<RenderResult | null>;
  exportToPdf(html: string, css: string, options?: PdfOptions, basePath?: string): Promise<Buffer>;
  exportToImage(html: string, css: string, options?: ImageOptions, basePath?: string): Promise<Buffer>;
  exportToImageParts(html: string, css: string, options?: ImageOptions, basePath?: string): Promise<Buffer[]>;
  close(): Promise<void>;
}

function resolveRendererHtmlPath(): string {
  // When bundled, use global module dir set by entry point
  const moduleDir = getModuleDir();
  return path.join(moduleDir, 'renderer', 'puppeteer-render.html');
}

function getPaperSizeInches(format: NonNullable<PdfOptions['format']>): { widthIn: number; heightIn: number } {
  // https://pptr.dev/api/puppeteer.pdfoptions/#format
  // Puppeteer uses standard paper sizes; keep a small mapping here.
  switch (format) {
    case 'Letter':
      return { widthIn: 8.5, heightIn: 11 };
    case 'Legal':
      return { widthIn: 8.5, heightIn: 14 };
    case 'A3':
      return { widthIn: 11.69, heightIn: 16.54 };
    case 'A5':
      return { widthIn: 5.83, heightIn: 8.27 };
    case 'A4':
    default:
      return { widthIn: 8.27, heightIn: 11.69 };
  }
}

/** Get default margins for a paper format */
function getDefaultMargins(format: NonNullable<PdfOptions['format']>): { top: string; bottom: string; left: string; right: string } {
  switch (format) {
    case 'A3':
      // Larger paper, use larger margins
      return { top: '25mm', bottom: '25mm', left: '20mm', right: '20mm' };
    case 'A5':
      // Smaller paper, use smaller margins
      return { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' };
    case 'Legal':
      // Taller paper, slightly larger vertical margins
      return { top: '25mm', bottom: '25mm', left: '20mm', right: '20mm' };
    case 'Letter':
    case 'A4':
    default:
      return { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' };
  }
}

function parseCssLengthToInches(value: string | number): number | null {
  // Handle numeric values (assumed to be pixels)
  if (typeof value === 'number') {
    return value / 96;
  }

  const v = String(value ?? '').trim();
  if (!v) return null;

  const m = v.match(/^(-?\d+(?:\.\d+)?)(px|in|mm|cm)$/i);
  if (!m) return null;

  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;

  const unit = m[2].toLowerCase();
  if (unit === 'in') return n;
  if (unit === 'cm') return n / 2.54;
  if (unit === 'mm') return n / 25.4;
  if (unit === 'px') return n / 96;

  return null;
}

/**
 * Create a browser-based renderer using Puppeteer
 */
export async function createBrowserRenderer(): Promise<BrowserRenderer | null> {
  // Try to load puppeteer
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.warn('Puppeteer dependency not found. Diagrams/HTML/SVG will be skipped.');
    console.warn('If you are using the published CLI, run via `npx md2x ...` (it installs Puppeteer automatically).');
    console.warn('If you are running from this repo, install CLI deps first: `npm -C node i` (or `pnpm -C node i`).');
    return null;
  }

  type Browser = Awaited<ReturnType<typeof puppeteer.launch>>;
  type Page = Awaited<ReturnType<Browser['newPage']>>;

  let browser: Browser | null = null;
  let page: Page | null = null;
  let runtimeDir: string | null = null;
  const debugLogs: string[] = [];

  const pushLog = (line: string): void => {
    debugLogs.push(line);
    if (debugLogs.length > 60) {
      debugLogs.shift();
    }
  };

  const createRuntimeDir = (): string => {
    const prefixes = [
      // Prefer workspace dir (works in sandboxed environments).
      path.join(process.cwd(), '.md2x-'),
      // Fallback to OS tmp for normal local runs.
      path.join(os.tmpdir(), 'md2x-'),
    ];

    for (const prefix of prefixes) {
      try {
        // mkdtemp requires the parent dir to exist
        fs.mkdirSync(path.dirname(prefix), { recursive: true });
        return fs.mkdtempSync(prefix);
      } catch {
        // Try next location
      }
    }

    throw new Error('Unable to create a writable temp directory for Chromium runtime files');
  };

  const setBaseHref = async (basePath?: string): Promise<void> => {
    if (!page || !basePath) return;

    // Ensure trailing slash so relative URLs resolve as expected
    const href = pathToFileURL(basePath + path.sep).href;
    await page.evaluate((h: string) => {
      const win = window as any;
      if (typeof win.__md2xSetBaseHref === 'function') {
        win.__md2xSetBaseHref(h);
        return;
      }
      let base = document.querySelector('base');
      if (!base) {
        base = document.createElement('base');
        document.head.appendChild(base);
      }
      (base as HTMLBaseElement).href = h;
    }, href);
  };

  const renderer: BrowserRenderer = {
    async initialize() {
      if (!puppeteer) return;

      const rendererHtmlPath = resolveRendererHtmlPath();
      if (!fs.existsSync(rendererHtmlPath)) {
        throw new Error(
          `Missing renderer assets: ${rendererHtmlPath}\n` +
            'Run `npm run node` to build the CLI (it generates node/dist/renderer/*).'
        );
      }

      runtimeDir = createRuntimeDir();
      const chromeProfileDir = path.join(runtimeDir, 'chrome-profile');
      fs.mkdirSync(chromeProfileDir, { recursive: true });

      browser = await puppeteer.launch({
        headless: true,
        userDataDir: chromeProfileDir,
        env: {
          ...process.env,
          // Keep Chromium support files out of the user's home directory.
          // This also makes it work in sandboxed environments where HOME is read-only.
          HOME: runtimeDir,
          XDG_CACHE_HOME: path.join(runtimeDir, 'xdg-cache'),
          XDG_CONFIG_HOME: path.join(runtimeDir, 'xdg-config'),
          XDG_DATA_HOME: path.join(runtimeDir, 'xdg-data'),
        },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--allow-file-access-from-files',
          // Prevent crash reporting (important in sandboxed environments).
          '--disable-crashpad',
          '--no-crashpad',
          `--crash-dumps-dir=${path.join(runtimeDir, 'crashpad')}`,
          `--user-data-dir=${chromeProfileDir}`,
          '--disable-breakpad',
          '--disable-crash-reporter',
          '--disable-features=Crashpad',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });

      page = await browser.newPage();
      page.on('console', (msg) => {
        pushLog(`[console.${msg.type()}] ${msg.text()}`);
      });
      page.on('pageerror', (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        pushLog(`[pageerror] ${message}`);
      });
      page.on('requestfailed', (req) => {
        const failure = req.failure();
        pushLog(`[requestfailed] ${req.url()} ${failure?.errorText ?? ''}`.trim());
      });
      await page.setViewport({ width: 2000, height: 2000 });

      // Load the local renderer page so relative assets (e.g., wasm) can resolve.
      await page.goto(pathToFileURL(rendererHtmlPath).href, { waitUntil: 'domcontentloaded' });

      try {
        await page.waitForFunction(() => (window as any).__md2xRenderReady === true, { timeout: 30_000 });
      } catch (error) {
        const hint =
          'Renderer page did not become ready within 30s.\n' +
          'Common causes:\n' +
          '- `puppeteer-render.html` has a <base> that breaks relative script loading\n' +
          '- missing/broken `node/dist/renderer/puppeteer-render-worker.js`\n' +
          '- browser console error during initialization\n';
        const tail = debugLogs.length ? `\nLast browser logs:\n${debugLogs.join('\n')}\n` : '';
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${hint}\nOriginal error: ${message}${tail}`);
      }
    },

    async render(type: string, content: string | object, basePath?: string, themeConfig?: RendererThemeConfig | null): Promise<RenderResult | null> {
      if (!page) return null;

      try {
        await setBaseHref(basePath);

        // md2x templates may include canvas/WebGL (e.g. MapLibre) which cannot be captured
        // by the SVG foreignObject-based HtmlRenderer. Use Puppeteer element screenshot instead.
        if (type === 'md2x') {
          // Match in-browser renderers' default high-res scale (see BaseRenderer.calculateCanvasScale()).
          // Clamp to avoid extremely large images.
          const calcDsf = (cfg: RendererThemeConfig | null): number => {
            const baseFontSize = 12;
            const themeFontSize = cfg?.fontSize ?? baseFontSize;
            const s = (14.0 / 16.0) * (themeFontSize / baseFontSize) * 4.0;
            return Math.max(1, Math.min(4, s));
          };

          try {
            const dsf = calcDsf(themeConfig ?? null);
            const vp = page.viewport();
            // Only update when needed; changing viewport can be expensive.
            if (!vp || vp.deviceScaleFactor !== dsf) {
              await page.setViewport({
                width: vp?.width ?? 2000,
                height: vp?.height ?? 2000,
                deviceScaleFactor: dsf,
              });
            }
          } catch {
            // ignore (best-effort)
          }

          const id = await page.evaluate(
            async (renderInput: string | object, cfg: RendererThemeConfig | null) => {
              const win = window as any;
              const fn = win.__md2xRenderToDom;
              if (typeof fn !== 'function') {
                throw new Error('__md2xRenderToDom is not available on page');
              }
              return await fn(renderInput, cfg);
            },
            content,
            themeConfig ?? null
          );

          try {
            await page.waitForSelector(`#${id}`, { timeout: 30_000 });
          } catch {
            // ignore
          }

          // Best-effort: wait for tiles/assets to settle.
          try {
            await (page as any).waitForNetworkIdle?.({ idleTime: 500, timeout: 15_000 });
          } catch {
            // ignore
          }

          const el = await page.$(`#${id}`);
          if (!el) {
            throw new Error(`md2x screenshot element not found: #${id}`);
          }

          const box = await el.boundingBox();
          const dpr = await page.evaluate(() => window.devicePixelRatio || 1).catch(() => 1);
          const buf = await el.screenshot({ type: 'png', omitBackground: true, captureBeyondViewport: true } as any);

          try {
            await page.evaluate((rid: string) => {
              const win = window as any;
              if (typeof win.__md2xCleanupDom === 'function') {
                win.__md2xCleanupDom(rid);
              }
            }, id);
          } catch {
            // ignore
          }

          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any);
          return {
            base64: b.toString('base64'),
            // Puppeteer reports element bounding boxes in CSS pixels; convert to physical pixels using devicePixelRatio.
            width: Math.max(1, Math.round((box?.width ?? 1) * (typeof dpr === 'number' && Number.isFinite(dpr) ? dpr : 1))),
            height: Math.max(1, Math.round((box?.height ?? 1) * (typeof dpr === 'number' && Number.isFinite(dpr) ? dpr : 1))),
            format: 'png',
          };
        }

        const result = await page.evaluate(
          async (renderType: string, renderInput: string | object, cfg: RendererThemeConfig | null) => {
            const win = window as any;
            const renderFn = win.__md2xRender;
            if (typeof renderFn !== 'function') {
              throw new Error('Renderer function not available on page');
            }
            return await renderFn(renderType, renderInput, cfg);
          },
          type,
          content,
          themeConfig ?? null
        );

        return result as RenderResult | null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to render ${type}: ${message}`);
        return null;
      }
    },

    async exportToPdf(html: string, css: string, options: PdfOptions = {}, basePath?: string): Promise<Buffer> {
      if (!page) {
        throw new Error('Browser not initialized');
      }

      // Create a new page for PDF export to avoid interfering with the render page
      const pdfPage = await browser!.newPage();

      // Create a temporary HTML file so that local file:// resources can be loaded
      // (setContent doesn't allow file:// access due to security restrictions)
      let tempHtmlPath: string | null = null;

      try {
        // Build full HTML document with embedded CSS
        // Use id="markdown-content" to match theme CSS selectors from themeToCSS
        // Include <title> for headerTemplate's <span class="title"></span>
        const title = options.title || 'Document';
        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <div id="markdown-content">${html}</div>
</body>
</html>`;

        if (basePath) {
          // Write HTML to a temp file in the basePath directory so relative paths resolve correctly
          tempHtmlPath = path.join(basePath, `__md2x_temp_${Date.now()}.html`);
          fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');
          await pdfPage.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: 'networkidle0' });
        } else {
          // No basePath, use setContent (relative paths won't work)
          await pdfPage.setContent(fullHtml, { waitUntil: 'networkidle0' });
        }

        // Best-effort: wait for live bootstrap (md2x/diagrams) to finish if present.
        try {
          const hasLive = await pdfPage.evaluate(() => typeof (window as any).__md2xLiveDone !== 'undefined');
          if (hasLive) {
            await pdfPage.waitForFunction(() => (window as any).__md2xLiveDone === true, { timeout: 60_000 });
          }
        } catch {
          // ignore
        }

        // Best-effort: wait for fonts + images so layout is stable before printing.
        try {
          await pdfPage.evaluate(async () => {
            const fontsReady = (document as any).fonts?.ready;
            if (fontsReady && typeof fontsReady.then === 'function') {
              await fontsReady;
            }

            const imgs = Array.from(document.images || []);
            await Promise.all(
              imgs.map((img) => {
                if ((img as HTMLImageElement).complete) return null;
                return new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                });
              })
            );
          });
        } catch {
          // ignore
        }

        // If a diagram is taller than a single printable page, scale it down so it fits.
        // This is best-effort: if the diagram is already constrained by width, it may still be too tall to fit nicely.
        const format = options.format || 'A4';
        const landscape = options.landscape || false;
        const pdfScale = options.scale || 1;
        const { widthIn, heightIn } = getPaperSizeInches(format);
        const pageHeightIn = landscape ? widthIn : heightIn;
        const defaultMargins = getDefaultMargins(format);

        const marginTopIn = parseCssLengthToInches(options.margin?.top ?? defaultMargins.top) ?? parseCssLengthToInches(defaultMargins.top)!;
        const marginBottomIn = parseCssLengthToInches(options.margin?.bottom ?? defaultMargins.bottom) ?? parseCssLengthToInches(defaultMargins.bottom)!;

        // Chromium uses 96 CSS pixels per inch; compensate for Puppeteer's pdf `scale` option.
        const printableHeightCssPx = ((pageHeightIn - marginTopIn - marginBottomIn) * 96) / pdfScale;

        await pdfPage.evaluate((printableHeightPx: number) => {
          const container = document.getElementById('markdown-content');
          if (!container) return;

          const cs = window.getComputedStyle(container);
          const padTop = parseFloat(cs.paddingTop || '0') || 0;
          const padBottom = parseFloat(cs.paddingBottom || '0') || 0;
          const available = Math.max(0, printableHeightPx - padTop - padBottom);

          const imgs = container.querySelectorAll('.md2x-diagram img.md2x-diagram, img.md2x-diagram');
          imgs.forEach((img) => {
            const el = img as HTMLImageElement;
            // Prefer current rendered size; fallback to natural.
            const rect = el.getBoundingClientRect();
            const currentHeight = rect.height || el.naturalHeight || 0;
            if (!currentHeight) return;

            if (currentHeight <= available + 0.5) return;

            el.style.maxHeight = `${available}px`;
            el.style.height = 'auto';
            el.style.width = 'auto';
            el.style.maxWidth = '100%';
            (el.style as any).objectFit = 'contain';
          });
        }, printableHeightCssPx);

        // Scale down wide fixed-width HTML blocks to fit page width.
        // Many HTML diagrams rely on explicit pixel widths + flex/grid; forcing width=100% can break layout.
        await pdfPage.evaluate(() => {
          const container = document.getElementById('markdown-content');
          if (!container) return;

          const availableWidth = container.clientWidth;
          if (!availableWidth) return;

          const wideDivs = container.querySelectorAll(':scope > div[style*="width"]');
          wideDivs.forEach((div) => {
            const el = div as HTMLElement;
            const widthMatch = el.style.width?.match(/^(\d+(?:\.\d+)?)px$/);
            if (!widthMatch) return;

            const fixedWidth = parseFloat(widthMatch[1]);
            if (!Number.isFinite(fixedWidth) || fixedWidth <= 0) return;

            const scale = Math.min(1, availableWidth / fixedWidth);
            if (scale >= 0.999) return;

            el.style.transformOrigin = 'top left';
            el.style.transform = `scale(${scale})`;
          });
        });

        // Generate PDF with options
        // Build pdf options, supporting custom width/height
        const pdfOpts: Parameters<typeof pdfPage.pdf>[0] = {
          printBackground: options.printBackground !== false,
          scale: options.scale || 1,
          displayHeaderFooter: options.displayHeaderFooter || false,
          headerTemplate: options.headerTemplate || '',
          footerTemplate: options.footerTemplate || '',
          margin: {
            top: options.margin?.top ?? defaultMargins.top,
            bottom: options.margin?.bottom ?? defaultMargins.bottom,
            left: options.margin?.left ?? defaultMargins.left,
            right: options.margin?.right ?? defaultMargins.right,
          },
        };

        // Use custom width/height if provided, otherwise use format
        if (options.width && options.height) {
          pdfOpts.width = options.width;
          pdfOpts.height = options.height;
        } else {
          pdfOpts.format = options.format || 'A4';
          pdfOpts.landscape = options.landscape || false;
        }

        const pdfBuffer = await pdfPage.pdf(pdfOpts);

        return Buffer.from(pdfBuffer);
      } finally {
        await pdfPage.close();
        // Clean up temporary HTML file
        if (tempHtmlPath) {
          try {
            fs.unlinkSync(tempHtmlPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    },

    async exportToImage(html: string, css: string, options: ImageOptions = {}, basePath?: string): Promise<Buffer> {
      const parts = await this.exportToImageParts(html, css, { ...options, split: false }, basePath);
      if (parts.length !== 1) {
        throw new Error('exportToImage() received multiple image parts. Use exportToImageParts() instead.');
      }
      return parts[0];
    },

    async exportToImageParts(html: string, css: string, options: ImageOptions = {}, basePath?: string): Promise<Buffer[]> {
      if (!page) {
        throw new Error('Browser not initialized');
      }

      const imagePage = await browser!.newPage();

      let tempHtmlPath: string | null = null;

      try {
        const vp = options.viewport ?? {};
        await imagePage.setViewport({
          width: Math.max(320, Math.floor(vp.width ?? 1200)),
          height: Math.max(240, Math.floor(vp.height ?? 800)),
          deviceScaleFactor: Math.max(0.25, vp.deviceScaleFactor ?? 1),
        });

        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  <div id="markdown-content">${html}</div>
</body>
</html>`;

        if (basePath) {
          tempHtmlPath = path.join(basePath, `__md2x_temp_${Date.now()}.html`);
          fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');
          await imagePage.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: 'networkidle0' });
        } else {
          await imagePage.setContent(fullHtml, { waitUntil: 'networkidle0' });
        }

        // Best-effort: wait for fonts + images so layout is stable before screenshot.
        try {
          await imagePage.evaluate(async () => {
            const fontsReady = (document as any).fonts?.ready;
            if (fontsReady && typeof fontsReady.then === 'function') {
              await fontsReady;
            }

            const imgs = Array.from(document.images || []);
            await Promise.all(
              imgs.map((img) => {
                if ((img as HTMLImageElement).complete) return null;
                return new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                });
              })
            );
          });
        } catch {
          // ignore
        }

        // Trigger lazy-loading (common on modern pages) by scrolling through the page before screenshot.
        const shouldScroll =
          typeof options.scrollToLoad === 'boolean'
            ? options.scrollToLoad
            : !options.selector && (options.fullPage !== false);
        if (shouldScroll) {
          const scroll = options.scroll ?? {};
          const delayMs = typeof scroll.delayMs === 'number' && Number.isFinite(scroll.delayMs) ? Math.max(0, scroll.delayMs) : 250;
          const maxSteps = typeof scroll.maxSteps === 'number' && Number.isFinite(scroll.maxSteps) ? Math.max(1, Math.floor(scroll.maxSteps)) : 40;
          const maxTimeMs = typeof scroll.maxTimeMs === 'number' && Number.isFinite(scroll.maxTimeMs) ? Math.max(100, Math.floor(scroll.maxTimeMs)) : 10_000;
          const stepPx = typeof scroll.stepPx === 'number' && Number.isFinite(scroll.stepPx) ? Math.max(1, scroll.stepPx) : 0;

          try {
            await imagePage.evaluate(
              async (cfg: { delayMs: number; maxSteps: number; maxTimeMs: number; stepPx: number }) => {
                const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
                const scroller = document.scrollingElement || document.documentElement;
                const startedAt = Date.now();

                const getStep = () => {
                  if (cfg.stepPx > 0) return cfg.stepPx;
                  return Math.max(1, Math.floor(window.innerHeight * 0.85));
                };

                let lastTop = -1;
                let stuck = 0;
                for (let i = 0; i < cfg.maxSteps; i++) {
                  const step = getStep();
                  scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
                  await sleep(cfg.delayMs);

                  const top = scroller.scrollTop;
                  if (top === lastTop) stuck++;
                  else stuck = 0;
                  lastTop = top;

                  const atBottom = top + window.innerHeight >= scroller.scrollHeight - 2;
                  if (atBottom || stuck >= 2) break;
                  if (Date.now() - startedAt > cfg.maxTimeMs) break;
                }

                // Scroll back to top so the snapshot starts from the expected position.
                scroller.scrollTop = 0;
                await sleep(Math.min(250, cfg.delayMs));
              },
              { delayMs, maxSteps, maxTimeMs, stepPx }
            );

            // Wait again after scrolling because newly visible images may still be loading.
            await imagePage.evaluate(async () => {
              const imgs = Array.from(document.images || []);
              await Promise.all(
                imgs.map((img) => {
                  if ((img as HTMLImageElement).complete) return null;
                  return new Promise<void>((resolve) => {
                    img.addEventListener('load', () => resolve(), { once: true });
                    img.addEventListener('error', () => resolve(), { once: true });
                  });
                })
              );
            });
          } catch {
            // ignore (scroll is best-effort)
          }

          // Best-effort: also wait for network to settle after lazy-load fetches.
          try {
            // Puppeteer provides this on Page.
            await (imagePage as any).waitForNetworkIdle?.({ idleTime: 500, timeout: 5_000 });
          } catch {
            // ignore
          }
        }

        // If live diagram bootstrap is present, wait for it to finish rendering before measuring/screenshot.
        try {
          const hasLive = await imagePage.evaluate(() => typeof (window as any).__md2xLiveDone !== 'undefined');
          if (hasLive) {
            await imagePage.waitForFunction(() => (window as any).__md2xLiveDone === true, { timeout: 60_000 });
            // Let any last async work settle.
            await (imagePage as any).waitForNetworkIdle?.({ idleTime: 500, timeout: 10_000 }).catch(() => {});
          }
        } catch {
          // ignore (best-effort)
        }

        // Clamp output width (physical pixels) by adjusting deviceScaleFactor.
        // This keeps layout the same but avoids huge images like 2600px+ wide.
        const maxPixelWidth = typeof options.maxPixelWidth === 'number' && Number.isFinite(options.maxPixelWidth)
          ? options.maxPixelWidth
          : 2000;
        if (maxPixelWidth > 0) {
          try {
            const cssWidth = await imagePage.evaluate((sel?: string | null) => {
              if (sel) {
                const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
                if (!els.length) return 0;
                let minX = Infinity;
                let maxX = -Infinity;
                for (const el of els) {
                  const r = el.getBoundingClientRect();
                  minX = Math.min(minX, r.left);
                  maxX = Math.max(maxX, r.right);
                }
                const w = maxX - minX;
                return Number.isFinite(w) ? w : 0;
              }
              const root = document.documentElement;
              return Math.max(root.scrollWidth, root.clientWidth) || 0;
            }, normalizeSelector(options.selector));

            if (cssWidth > 0) {
              const current = imagePage.viewport();
              const currentDsf = (current?.deviceScaleFactor ?? 1) as number;
              const desiredDsf = Math.min(currentDsf, maxPixelWidth / cssWidth);
              const nextDsf = Math.max(0.25, desiredDsf);

              if (Math.abs(nextDsf - currentDsf) >= 0.01) {
                await imagePage.setViewport({
                  width: current?.width ?? Math.max(320, Math.floor(vp.width ?? 1200)),
                  height: current?.height ?? Math.max(240, Math.floor(vp.height ?? 800)),
                  deviceScaleFactor: nextDsf,
                });
              }
            }
          } catch {
            // ignore (best-effort)
          }
        }

        const type = options.type ?? 'png';
        const fullPage = options.fullPage !== false;

        const screenshotOpts: any = { type };

        if ((type === 'jpeg' || type === 'webp') && typeof options.quality === 'number') {
          const q = Math.max(0, Math.min(100, Math.round(options.quality)));
          screenshotOpts.quality = q;
        }

        if (typeof options.fromSurface === 'boolean') {
          screenshotOpts.fromSurface = options.fromSurface;
        }

        const attempt = async (opts: any): Promise<Buffer> => {
          const out = await imagePage.screenshot(opts);
          return Buffer.isBuffer(out) ? out : Buffer.from(out as any);
        };

        const getScrollDims = async (): Promise<{ width: number; height: number; dpr: number }> => {
          try {
            return await imagePage.evaluate(() => {
              const el = document.documentElement;
              const body = document.body;
              return {
                width: Math.max(el.scrollWidth, body?.scrollWidth ?? 0, el.clientWidth),
                height: Math.max(el.scrollHeight, body?.scrollHeight ?? 0, el.clientHeight),
                dpr: window.devicePixelRatio || 1,
              };
            });
          } catch {
            return { width: 0, height: 0, dpr: 1 };
          }
        };

        // Selector capture
        if (options.selector) {
          const sel = normalizeSelector(options.selector);
          if (!sel) throw new Error('image.selector is empty');

          await imagePage.waitForSelector(sel, { timeout: 30_000 });
          const elements = await imagePage.$$(sel);
          if (!elements.length) {
            throw new Error(`Element not found for selector: ${sel}`);
          }

          // Default to "stitch" so multi-match selectors don't accidentally capture unrelated in-between content.
          const selectorMode: NonNullable<ImageOptions['selectorMode']> = options.selectorMode ?? 'stitch';
          const targets = selectorMode === 'first' ? [elements[0]] : elements;

          const pad = typeof options.selectorPadding === 'number' && Number.isFinite(options.selectorPadding)
            ? Math.max(0, options.selectorPadding)
            : 0;

          // "stitch": stack all matching elements into a temporary container and capture it,
          // so the output includes ONLY the selected elements (no in-between page content).
          if (selectorMode === 'stitch') {
            const gap = typeof options.selectorGap === 'number' && Number.isFinite(options.selectorGap)
              ? Math.max(0, Math.floor(options.selectorGap))
              : 0;
            const containerSelector = '#__md2x_selector_stitch__';

            const cleanup = async () => {
              try {
                await imagePage.evaluate(() => {
                  const key = '__md2xSelectorStitchState';
                  const state = (window as any)[key] as any;
                  if (!state) return;

                  const moves = Array.isArray(state.moves) ? state.moves : [];
                  for (const m of moves) {
                    try {
                      const el = m && m.el;
                      const ph = m && m.ph;
                      if (!el || !ph) continue;
                      const parent = (ph as any).parentNode as Node | null;
                      if (!parent) continue;
                      parent.insertBefore(el, ph);
                      (ph as any).remove?.();
                    } catch {
                      // ignore
                    }
                  }
                  try {
                    (state.container as any)?.remove?.();
                  } catch {
                    // ignore
                  }
                  try {
                    delete (window as any)[key];
                  } catch {
                    // ignore
                  }
                });
              } catch {
                // ignore
              }
            };

            await cleanup();
            try {
              await imagePage.evaluate((selector: string, gapPx: number) => {
                const key = '__md2xSelectorStitchState';
                const existing = (window as any)[key] as any;
                if (existing && existing.container) {
                  try { existing.container.remove(); } catch {}
                }

                const root =
                  (document.getElementById('markdown-content') as HTMLElement | null) ||
                  (document.body as HTMLElement);

                const container = document.createElement('div');
                container.id = '__md2x_selector_stitch__';
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                // Center each stitched element horizontally for a cleaner export.
                container.style.alignItems = 'stretch';
                container.style.gap = String(gapPx) + 'px';
                container.style.maxWidth = '100%';
                container.style.boxSizing = 'border-box';

                // Keep container in the same styling/inheritance context as the document content.
                root.appendChild(container);

                const all = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
                // If the selector matches nested elements (e.g. both wrapper and its child),
                // only keep top-level matches to avoid tearing nodes out of their containers.
                const els = all.filter((el) => {
                  let p = el.parentElement;
                  while (p) {
                    try {
                      if (p.matches(selector)) return false;
                    } catch {
                      // ignore invalid selector edge cases (shouldn't happen; selector already used for querySelectorAll)
                    }
                    p = p.parentElement;
                  }
                  return true;
                });
                const moves: any[] = [];
                for (const el of els) {
                  const parent = el.parentNode;
                  if (!parent) continue;
                  const ph = document.createComment('md2x-stitch');
                  parent.insertBefore(ph, el);
                  // Wrap each element so we can center it without mutating its styles.
                  const slot = document.createElement('div');
                  slot.style.display = 'flex';
                  slot.style.justifyContent = 'center';
                  slot.style.alignItems = 'flex-start';
                  slot.style.width = '100%';
                  slot.style.boxSizing = 'border-box';
                  slot.appendChild(el);
                  container.appendChild(slot);
                  moves.push({ el, ph });
                }

                (window as any)[key] = { container, moves };
              }, sel, gap);

              await imagePage.waitForSelector(containerSelector, { timeout: 5_000 });
              const containerHandle = await imagePage.$(containerSelector);
              if (!containerHandle) {
                throw new Error(`Unable to create stitch container for selector: ${sel}`);
              }

              // Let layout settle before measuring.
              try {
                await imagePage.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
              } catch {
                // ignore
              }

              const docSize = await imagePage.evaluate(() => {
                const el = document.documentElement;
                const body = document.body;
                const width = Math.max(el.scrollWidth, body?.scrollWidth ?? 0, el.clientWidth);
                const height = Math.max(el.scrollHeight, body?.scrollHeight ?? 0, el.clientHeight);
                return { width, height };
              });

              const box = await containerHandle.boundingBox();
              if (!box) throw new Error(`Unable to determine bounding box for selector: ${sel}`);

              const x = Math.max(0, box.x - pad);
              const y = Math.max(0, box.y - pad);
              const width = Math.min(docSize.width - x, box.width + pad * 2);
              const height = Math.min(docSize.height - y, box.height + pad * 2);
              if (!(width > 0) || !(height > 0)) {
                throw new Error(`Unable to determine bounding box for selector: ${sel}`);
              }

              const stitchedOpts: any = {
                ...screenshotOpts,
                clip: { x, y, width, height },
                captureBeyondViewport: typeof options.captureBeyondViewport === 'boolean' ? options.captureBeyondViewport : true,
                omitBackground: options.omitBackground ?? false,
              };
              return [await attempt(stitchedOpts)];
            } finally {
              await cleanup();
            }
          }

          const docSize = await imagePage.evaluate(() => {
            const el = document.documentElement;
            const body = document.body;
            const width = Math.max(el.scrollWidth, body?.scrollWidth ?? 0, el.clientWidth);
            const height = Math.max(el.scrollHeight, body?.scrollHeight ?? 0, el.clientHeight);
            return { width, height };
          });

          const captureEach = async (): Promise<Buffer[]> => {
            const buffers: Buffer[] = [];
            let idx = 0;
            for (const el of targets) {
              try {
                await el.evaluate((node) => {
                  (node as HTMLElement).scrollIntoView({ block: 'start', inline: 'nearest' });
                });
              } catch {
                // ignore
              }

              const box = await el.boundingBox();
              if (!box) continue;

              const x = Math.max(0, box.x - pad);
              const y = Math.max(0, box.y - pad);
              const width = Math.min(docSize.width - x, box.width + pad * 2);
              const height = Math.min(docSize.height - y, box.height + pad * 2);
              if (!(width > 0) || !(height > 0)) continue;

              const eachOpts: any = {
                ...screenshotOpts,
                clip: { x, y, width, height },
                captureBeyondViewport: typeof options.captureBeyondViewport === 'boolean' ? options.captureBeyondViewport : true,
                omitBackground: options.omitBackground ?? false,
              };

              if (idx > 0) {
                await new Promise((r) => setTimeout(r, 40));
              }
              buffers.push(await attempt(eachOpts));
              idx++;
            }
            return buffers;
          };

          if (selectorMode === 'each') {
            const buffers = await captureEach();
            if (!buffers.length) {
              throw new Error(`Unable to determine bounding box for selector: ${sel}`);
            }
            return buffers;
          }

          // union (default): compute union bounding box of all matches
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          const bottoms: number[] = [];

          for (const el of targets) {
            const box = await el.boundingBox();
            if (!box) continue;
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
            bottoms.push(Math.round(box.y + box.height));
          }

          if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            throw new Error(`Unable to determine bounding box for selector: ${sel}`);
          }

          const x0 = Math.max(0, minX - pad);
          const y0 = Math.max(0, minY - pad);
          const x1 = Math.min(docSize.width, maxX + pad);
          const y1 = Math.min(docSize.height, maxY + pad);
          const clipW = Math.max(1, x1 - x0);
          const clipH = Math.max(1, y1 - y0);

          const splitSetting = options.split ?? 'auto';
          const dpr = Math.max(
            0.25,
            (await imagePage.evaluate(() => window.devicePixelRatio || 1).catch(() => 1)) as number
          );
          const estimatedPixelHeight = Math.ceil(clipH * dpr);
          const shouldSplit =
            splitSetting === true ||
            (splitSetting === 'auto' && estimatedPixelHeight > 30_000);

          if (!shouldSplit) {
            const unionOpts: any = {
              ...screenshotOpts,
              clip: { x: x0, y: y0, width: clipW, height: clipH },
              captureBeyondViewport: typeof options.captureBeyondViewport === 'boolean' ? options.captureBeyondViewport : true,
              omitBackground: options.omitBackground ?? false,
            };
            return [await attempt(unionOpts)];
          }

          // Split within union region, preferring element boundaries.
          const maxPixelHeight =
            typeof options.splitMaxPixelHeight === 'number' && Number.isFinite(options.splitMaxPixelHeight)
              ? Math.max(500, Math.floor(options.splitMaxPixelHeight))
              : 14_000;
          const overlap =
            typeof options.splitOverlapPx === 'number' && Number.isFinite(options.splitOverlapPx)
              ? Math.max(0, Math.floor(options.splitOverlapPx))
              : 0;

          const sliceCssHeight = Math.max(200, Math.floor(maxPixelHeight / dpr));
          const minSlice = Math.min(400, Math.floor(sliceCssHeight * 0.25));

          const candidates = Array.from(new Set([...bottoms, Math.round(y1)]))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.max(0, Math.round(n)))
            .sort((a, b) => a - b);

          const findCut = (start: number): number => {
            const ideal = Math.min(y1, start + sliceCssHeight);
            if (ideal >= y1) return y1;
            let best = -1;
            for (const c of candidates) {
              if (c <= start + 1) continue;
              if (c > ideal) break;
              if (c - start < minSlice) continue;
              best = c;
            }
            return best > 0 ? best : Math.max(start + 1, ideal);
          };

          const buffers: Buffer[] = [];
          let y = y0;
          let idx = 0;
          while (y < y1 && idx < 10_000) {
            const end = findCut(y);
            const h = Math.max(1, end - y);
            const sliceOpts: any = {
              ...screenshotOpts,
              clip: { x: x0, y, width: clipW, height: h },
              captureBeyondViewport: true,
              omitBackground: options.omitBackground ?? false,
            };
            if (idx > 0) {
              await new Promise((r) => setTimeout(r, 40));
            }
            buffers.push(await attempt(sliceOpts));
            if (end >= y1) break;
            y = Math.max(y0, end - overlap);
            idx++;
          }
          return buffers;
        }

        // Non-full-page capture (single part)
        if (!fullPage) {
          screenshotOpts.fullPage = false;
          screenshotOpts.captureBeyondViewport = false;
          screenshotOpts.omitBackground = options.omitBackground ?? false;
          return [await attempt(screenshotOpts)];
        }

        // Full-page capture: decide between single vs multi-part (split)
        const dims = await getScrollDims();
        const dpr = Math.max(0.25, dims.dpr || 1);
        const estimatedPixelHeight = Math.ceil((dims.height || 0) * dpr);

        const splitSetting = options.split ?? 'auto';
        const shouldSplit =
          splitSetting === true ||
          (splitSetting === 'auto' && estimatedPixelHeight > 30_000);

        if (shouldSplit) {
          const maxPixelHeight =
            typeof options.splitMaxPixelHeight === 'number' && Number.isFinite(options.splitMaxPixelHeight)
              ? Math.max(500, Math.floor(options.splitMaxPixelHeight))
              : 14_000;
          const overlap =
            typeof options.splitOverlapPx === 'number' && Number.isFinite(options.splitOverlapPx)
              ? Math.max(0, Math.floor(options.splitOverlapPx))
              : 0;

          const sliceCssHeight = Math.max(200, Math.floor(maxPixelHeight / dpr));

          const docW = Math.max(1, dims.width || (imagePage.viewport()?.width ?? 1200));
          const docH = Math.max(1, dims.height || (imagePage.viewport()?.height ?? 800));

          const buffers: Buffer[] = [];
          let y = 0;
          let idx = 0;

          // Build cut candidates at block boundaries to avoid splitting the same element across parts.
          const cutCandidates = await imagePage.evaluate(() => {
            const root = document.getElementById('markdown-content') as HTMLElement | null;
            const scroller = document.scrollingElement || document.documentElement;
            // Ensure we measure in a stable scroll position.
            scroller.scrollTop = 0;

            const candidates: number[] = [0];

            const pushBottom = (el: Element) => {
              const rect = (el as HTMLElement).getBoundingClientRect();
              const bottom = rect.bottom + (window.scrollY || 0);
              if (Number.isFinite(bottom)) {
                // Clip uses CSS px; round to integer to avoid fractional seams.
                candidates.push(Math.round(bottom));
              }
            };

            if (root) {
              const blocks = Array.from(root.children);
              blocks.forEach((b) => {
                // For large lists, also consider li boundaries (but keep other containers intact).
                const tag = (b as HTMLElement).tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') {
                  const items = Array.from(b.querySelectorAll(':scope > li'));
                  if (items.length > 0) {
                    items.forEach(pushBottom);
                    return;
                  }
                }
                pushBottom(b);
              });
            }

            const height = Math.max(scroller.scrollHeight, document.documentElement.scrollHeight);
            candidates.push(Math.round(height));

            // De-dup + sort
            candidates.sort((a, b) => a - b);
            const uniq: number[] = [];
            for (const n of candidates) {
              const v = Math.max(0, n);
              if (!uniq.length || uniq[uniq.length - 1] !== v) uniq.push(v);
            }
            return uniq;
          });

          const findCut = (start: number): number => {
            const ideal = Math.min(docH, start + sliceCssHeight);
            if (ideal >= docH) return docH;

            // Find the largest candidate <= ideal that is > start (avoid 0-length slices).
            // Also avoid producing extremely tiny slices when we can.
            const minSlice = Math.min(400, Math.floor(sliceCssHeight * 0.25));
            let best = -1;
            for (let i = 0; i < cutCandidates.length; i++) {
              const c = cutCandidates[i];
              if (c <= start + 1) continue;
              if (c > ideal) break;
              if (c - start < minSlice) continue;
              best = c;
            }
            if (best > 0) return best;
            // Fallback: allow splitting inside a large element.
            return Math.max(start + 1, ideal);
          };

          while (y < docH && idx < 10_000) {
            const end = findCut(y);
            const h = Math.max(1, end - y);

            const sliceOpts: any = {
              ...screenshotOpts,
              clip: { x: 0, y, width: docW, height: h },
              captureBeyondViewport: true,
              omitBackground: options.omitBackground ?? false,
            };

            // Help viewport-based lazy-loaders by scrolling near the slice.
            try {
              await imagePage.evaluate((top: number) => {
                const scroller = document.scrollingElement || document.documentElement;
                scroller.scrollTop = Math.max(0, top);
              }, y);
            } catch {
              // ignore
            }

            if (idx > 0) {
              await new Promise((r) => setTimeout(r, 80));
            }

            buffers.push(await attempt(sliceOpts));

            if (end >= docH) break;
            y = Math.max(0, end - overlap);
            idx++;
          }

          try {
            await imagePage.evaluate(() => {
              const scroller = document.scrollingElement || document.documentElement;
              scroller.scrollTop = 0;
            });
          } catch {
            // ignore
          }

          return buffers;
        }

        // Single-image full-page capture (with retries)
        screenshotOpts.fullPage = true;
        screenshotOpts.captureBeyondViewport =
          typeof options.captureBeyondViewport === 'boolean' ? options.captureBeyondViewport : false;
        screenshotOpts.omitBackground = options.omitBackground ?? false;

        if (screenshotOpts.captureBeyondViewport === false) {
          const maxViewportDim = 16_000;
          if ((dims.width && dims.width > maxViewportDim) || (dims.height && dims.height > maxViewportDim)) {
            screenshotOpts.captureBeyondViewport = true;
          }
        }

        try {
          return [await attempt(screenshotOpts)];
        } catch (e1) {
          const msg1 = e1 instanceof Error ? e1.message : String(e1);
          if (screenshotOpts.fromSurface === false) {
            const retry1 = { ...screenshotOpts };
            delete retry1.fromSurface;
            try {
              return [await attempt(retry1)];
            } catch {
              // continue
            }
          }
          if (screenshotOpts.fullPage && typeof screenshotOpts.captureBeyondViewport === 'boolean') {
            const retry2 = { ...screenshotOpts, captureBeyondViewport: !screenshotOpts.captureBeyondViewport };
            if (retry2.fromSurface === false) delete retry2.fromSurface;
            try {
              return [await attempt(retry2)];
            } catch {
              // continue
            }
          }
          throw new Error(`Unable to capture screenshot. ${msg1}`);
        }
      } finally {
        await imagePage.close();
        if (tempHtmlPath) {
          try {
            fs.unlinkSync(tempHtmlPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    },

    async close() {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }

      if (runtimeDir) {
        try {
          fs.rmSync(runtimeDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
        runtimeDir = null;
      }
    },
  };

  return renderer;
}

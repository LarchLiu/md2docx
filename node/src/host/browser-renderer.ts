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
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
  printBackground?: boolean;
  scale?: number;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

export interface BrowserRenderer {
  initialize(): Promise<void>;
  render(type: string, content: string | object, basePath?: string, themeConfig?: RendererThemeConfig | null): Promise<RenderResult | null>;
  exportToPdf(html: string, css: string, options?: PdfOptions, basePath?: string): Promise<Buffer>;
  close(): Promise<void>;
}

function resolveRendererHtmlPath(): string {
  // When bundled, import.meta.url points to node/dist/md2x.mjs
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, 'renderer', 'puppeteer-render.html');
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

  return {
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
          // Write HTML to a temp file in the basePath directory so relative paths resolve correctly
          tempHtmlPath = path.join(basePath, `__md2x_temp_${Date.now()}.html`);
          fs.writeFileSync(tempHtmlPath, fullHtml, 'utf-8');
          await pdfPage.goto(pathToFileURL(tempHtmlPath).href, { waitUntil: 'networkidle0' });
        } else {
          // No basePath, use setContent (relative paths won't work)
          await pdfPage.setContent(fullHtml, { waitUntil: 'networkidle0' });
        }

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
        const pdfBuffer = await pdfPage.pdf({
          format: options.format || 'A4',
          landscape: options.landscape || false,
          printBackground: options.printBackground !== false,
          scale: options.scale || 1,
          displayHeaderFooter: options.displayHeaderFooter || false,
          headerTemplate: options.headerTemplate || '',
          footerTemplate: options.footerTemplate || '',
          margin: {
            top: options.margin?.top || '20mm',
            bottom: options.margin?.bottom || '20mm',
            left: options.margin?.left || '15mm',
            right: options.margin?.right || '15mm',
          },
        });

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
}

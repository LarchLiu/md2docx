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

export interface BrowserRenderer {
  initialize(): Promise<void>;
  render(type: string, content: string | object, basePath?: string, themeConfig?: RendererThemeConfig | null): Promise<RenderResult | null>;
  close(): Promise<void>;
}

function resolveRendererHtmlPath(): string {
  // When bundled, import.meta.url points to node/dist/md2docx.mjs
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
    console.warn('If you are using the published CLI, run via `npx @cloudgeek/md2docx ...` (it installs Puppeteer automatically).');
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
      path.join(process.cwd(), '.md2docx-'),
      // Fallback to OS tmp for normal local runs.
      path.join(os.tmpdir(), 'md2docx-'),
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
      if (typeof win.__md2docxSetBaseHref === 'function') {
        win.__md2docxSetBaseHref(h);
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
        await page.waitForFunction(() => (window as any).__md2docxRenderReady === true, { timeout: 30_000 });
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
            const renderFn = win.__md2docxRender;
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

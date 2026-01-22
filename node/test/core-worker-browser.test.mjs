import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadApi } from './setup.mjs';
import { canUseBrowser, makeOutSubdir, writeUtf8, outDir } from './test-utils.mjs';
import { readFixture } from './fixtures.mjs';

let api;

before(async () => {
  api = await loadApi();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startStaticServer(routes) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const r = routes[url.pathname];
      if (!r) {
        res.statusCode = 404;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('not found');
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', r.contentType);
      res.end(r.body);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(String(e && e.message ? e.message : e));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => await new Promise((resolve) => server.close(() => resolve())),
  };
}

describe('core-worker-browser bundle', () => {
  test('runs markdownToStandaloneHtml inside a module Web Worker', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');

    const puppeteer = (await import('puppeteer')).default;

    // const outDir = makeOutSubdir('core-worker-browser-');
    const md = readFixture('full.md');

    const modulePath = path.join(__dirname, '..', 'dist', 'renderer', 'core-worker-browser.js');
    const moduleSrc = fs.readFileSync(modulePath, 'utf8');

    const workerJs = `import * as mod from '/core-worker-browser.js';
self.onmessage = async (ev) => {
  try {
    const mdUrl = ev && ev.data && ev.data.mdUrl ? String(ev.data.mdUrl) : '/full.md';
    const md = await (await fetch(mdUrl)).text();
    const html = await mod.markdownToStandaloneHtml(md, { title: 'Full Test', theme: 'rainbow', liveDiagrams: true });
    self.postMessage({ ok: true, htmlLength: html.length, html });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>core-worker-browser test</title>
</head>
<body>
  <div id="status">running...</div>
  <script type="module">
    (async () => {
      try {
        const w = new Worker('/worker.js', { type: 'module' });
        w.onmessage = (ev) => {
          window.__testResult = ev && ev.data ? ev.data : {};
          document.getElementById('status').textContent = (window.__testResult && window.__testResult.ok) ? 'ok' : 'error';
          window.__testDone = true;
        };
        w.onerror = (ev) => {
          window.__testResult = { ok: false, error: String(ev && ev.message ? ev.message : ev) };
          document.getElementById('status').textContent = 'error';
          window.__testDone = true;
        };
        w.postMessage({ mdUrl: '/full.md' });
      } catch (e) {
        window.__testResult = { ok: false, error: String(e && e.message ? e.message : e) };
        document.getElementById('status').textContent = 'error';
        window.__testDone = true;
      }
    })();
  </script>
</body>
</html>`;

    const server = await startStaticServer({
      '/': { contentType: 'text/html; charset=utf-8', body: html },
      '/index.html': { contentType: 'text/html; charset=utf-8', body: html },
      '/full.md': { contentType: 'text/plain; charset=utf-8', body: md },
      '/core-worker-browser.js': { contentType: 'text/javascript; charset=utf-8', body: moduleSrc },
      '/worker.js': { contentType: 'text/javascript; charset=utf-8', body: workerJs },
    });

    const browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(outDir, 'chrome-profile'),
      env: {
        ...process.env,
        HOME: outDir,
        XDG_CACHE_HOME: path.join(outDir, 'xdg-cache'),
        XDG_CONFIG_HOME: path.join(outDir, 'xdg-config'),
        XDG_DATA_HOME: path.join(outDir, 'xdg-data'),
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-crashpad',
        '--no-crashpad',
        '--disable-breakpad',
        '--disable-crash-reporter',
        '--disable-features=Crashpad',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.goto(`${server.url}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window).__testDone === true, { timeout: 60_000 });

      const result = await page.evaluate(() => {
        const r = (window).__testResult || {};
        return {
          ok: !!r.ok,
          error: r.error ? String(r.error) : '',
          htmlLength: typeof r.htmlLength === 'number' ? r.htmlLength : 0,
          html: typeof r.html === 'string' ? r.html : '',
        };
      });

      // Always persist worker output for debugging.
      const outHtmlPath = path.join(outDir, 'core-worker-browser.html');
      const outJsonPath = path.join(outDir, 'core-worker-browser.json');
      writeUtf8(outHtmlPath, result.html || '');
      writeUtf8(outJsonPath, JSON.stringify({ ...result, html: undefined }, null, 2));

      const htmlOut = result.html || '';
      const info = {
        ok: result.ok,
        error: result.error,
        htmlLength: result.htmlLength || htmlOut.length || 0,
        hasDoctype: htmlOut.includes('<!DOCTYPE html>'),
        hasTitle: htmlOut.includes('<title>Full Test</title>'),
        hasBootstrap: htmlOut.includes('md2x live diagram renderer (CDN)'),
        hasTemplateFiles: htmlOut.includes('md2xTemplateFiles'),
        hasVueExample: htmlOut.includes('"vue/example.vue"'),
        hasSvelteExample: htmlOut.includes('"svelte/example.svelte"'),
        hasHtmlExample: htmlOut.includes('"html/example.html"'),
        hasMapLibre: htmlOut.includes('"vue/mapLibre.vue"'),
      };

      assert.ok(info.ok, info.error || 'browser module execution failed');
      assert.ok(info.htmlLength > 1000, `expected html length > 1000, got ${info.htmlLength}`);
      assert.ok(info.hasDoctype);
      assert.ok(info.hasTitle);
      assert.ok(info.hasBootstrap);
      assert.ok(info.hasTemplateFiles);
      assert.ok(info.hasVueExample);
      assert.ok(info.hasSvelteExample);
      assert.ok(info.hasHtmlExample);
      assert.ok(info.hasMapLibre);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});

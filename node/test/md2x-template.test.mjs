import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { describe, test, before } from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadApi } from './setup.mjs';
import { canUseBrowser, makeOutSubdir, writeUtf8 } from './test-utils.mjs';

let api;

before(async () => {
  api = await loadApi();
});

async function renderHtmlInPuppeteer(htmlPath, runtimeDir) {
  const puppeteer = (await import('puppeteer')).default;

  const chromeProfileDir = path.join(runtimeDir, 'chrome-profile');
  fs.mkdirSync(chromeProfileDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: chromeProfileDir,
    env: {
      ...process.env,
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

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window).__md2xLiveDone === true, { timeout: 60_000 });
    return await page.evaluate(() => document.documentElement.outerHTML);
  } finally {
    await browser.close();
  }
}

describe('md2x templates (vue)', () => {
  test('embeds md2x vue template into exported HTML (live runtime bootstrap)', async () => {
    const tmpDir = makeOutSubdir('md2x-template-');
    const tplPath = path.join(tmpDir, 'vue', 'my-component.vue');
    fs.mkdirSync(path.dirname(tplPath), { recursive: true });

    const tplContent = `<script setup>
const data = templateData;
</script>

<template>
  <div class="root">{{ Array.isArray(data) ? data.length : 'nope' }}</div>
</template>
`;
    writeUtf8(tplPath, tplContent);

    const md = [
      '# md2x vue template test',
      '',
      '```md2x',
      "type: 'vue',",
      "template: 'my-component.vue',",
      "data: [{ title: 'hello', message: 'world' }]",
      '```',
      '',
    ].join('\n');

    const html = await api.markdownToHtmlString(md, {
      basePath: tmpDir,
      standalone: true,
      diagramMode: 'live',
      // Make the output runnable directly via file:// (no /dist/renderer/... path assumptions).
      liveRuntime: 'inline',
      templates: {
        'vue/my-component.vue': tplContent,
        'my-component.vue': tplContent,
      },
    });

    const outHtmlPath = path.join(tmpDir, 'out.live.html');
    writeUtf8(outHtmlPath, html);

    assert.ok(html.includes('md2xTemplateFiles'));
    assert.ok(html.includes('"my-component.vue"'));
    assert.ok(html.includes('"vue/my-component.vue"'));
    // The bootstrap JSON replaces `<` with `\\u003c` to avoid `</script>` hazards.
    assert.ok(html.includes('\\u003cscript setup>'));
    assert.ok(html.includes('templateData'));
    assert.ok(html.includes('md2x live diagram renderer (worker mountToDom)'));
    assert.ok(html.includes('__md2xRenderDocument'));
  });

  test('embeds templates from external templateDir into exported HTML (live runtime bootstrap)', async () => {
    const tmpDocDir = makeOutSubdir('md2x-doc-');
    const tmpTplDir = makeOutSubdir('md2x-tpl-');
    const tplPath = path.join(tmpTplDir, 'vue', 'my-component.vue');
    fs.mkdirSync(path.dirname(tplPath), { recursive: true });

    const tplContent = `<script setup>
const data = templateData;
</script>
<template><div class="ok">ok</div></template>
`;
    writeUtf8(tplPath, tplContent);

    const md = [
      '# test',
      '',
      '```md2x',
      "type: 'vue',",
      // Intentionally only a filename; resolver should use type + '/' + template.
      "template: 'my-component.vue',",
      "data: [{ title: 'a' }]",
      '```',
      '',
    ].join('\n');

    const html = await api.markdownToHtmlString(md, {
      basePath: tmpDocDir,
      diagramMode: 'live',
      standalone: true,
      liveRuntime: 'inline',
      templates: {
        'vue/my-component.vue': tplContent,
        'my-component.vue': tplContent,
      },
    });

    const outHtmlPath = path.join(tmpDocDir, 'out.template-dir.html');
    writeUtf8(outHtmlPath, html);

    assert.ok(html.includes('"my-component.vue"'));
    assert.ok(html.includes('"vue/my-component.vue"'));
  });

  test('renders vue template to DOM (integration; requires browser + network)', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');

    const tmpDir = makeOutSubdir('md2x-template-render-');
    const tplPath = path.join(tmpDir, 'vue', 'my-component.vue');
    fs.mkdirSync(path.dirname(tplPath), { recursive: true });

    const tplContent = `<script setup>
const data = templateData;
</script>

<template>
  <div class="root">{{ Array.isArray(data) ? data.length : 'nope' }}</div>
</template>
`;
    writeUtf8(tplPath, tplContent);

    const md = [
      '# md2x vue template render test',
      '',
      '```md2x',
      "type: 'vue',",
      "template: 'my-component.vue',",
      "data: [{ title: 'hello', message: 'world' }]",
      '```',
      '',
    ].join('\n');

    const html = await api.markdownToHtmlString(md, {
      basePath: tmpDir,
      standalone: true,
      diagramMode: 'live',
      liveRuntime: 'inline',
      templates: {
        'vue/my-component.vue': tplContent,
        'my-component.vue': tplContent,
      },
    });

    const outHtmlPath = path.join(tmpDir, 'out.render.html');
    writeUtf8(outHtmlPath, html);

    const dom = await renderHtmlInPuppeteer(outHtmlPath, path.join(tmpDir, 'chrome-runtime'));
    assert.ok(dom.includes('<div class="root">1</div>'));
  });

  test('renders template from templates to DOM (integration; requires browser + network)', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');

    const tmpDocDir = makeOutSubdir('md2x-doc-render-');
    const tmpTplDir = makeOutSubdir('md2x-tpl-render-');
    const tplPath = path.join(tmpTplDir, 'vue', 'my-component.vue');
    fs.mkdirSync(path.dirname(tplPath), { recursive: true });

    const tplContent = `<script setup>
const data = templateData;
</script>
<template><div class="ok">ok</div></template>
`;
    writeUtf8(tplPath, tplContent);

    const md = [
      '# test',
      '',
      '```md2x',
      "type: 'vue',",
      // Intentionally only a filename; resolver should use type + '/' + template.
      "template: 'my-component.vue',",
      "data: [{ title: 'a' }]",
      '```',
      '',
    ].join('\n');

    const html = await api.markdownToHtmlString(md, {
      basePath: tmpDocDir,
      diagramMode: 'live',
      standalone: true,
      liveRuntime: 'inline',
      templates: {
        'vue/my-component.vue': tplContent,
        'my-component.vue': tplContent,
      },
    });

    const outHtmlPath = path.join(tmpDocDir, 'out.render.html');
    writeUtf8(outHtmlPath, html);

    const dom = await renderHtmlInPuppeteer(outHtmlPath, path.join(tmpDocDir, 'chrome-runtime'));
    assert.ok(dom.includes('<div class="ok">ok</div>'));
  });
});

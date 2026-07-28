import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { describe, test, before } from 'node:test';

import { loadApi } from './setup.mjs';
import { readFixture } from './fixtures.mjs';
import { canUseBrowser, makeFrontMatterDoc, withTempDir, writeUtf8 } from './test-utils.mjs';

let api;

before(async () => {
  api = await loadApi();
});

describe('format: html', () => {
  test('convert() returns standalone HTML when options.format=html', async () => {
    const markdown = readFixture('basic.md');
    const { buffer, format } = await api.convert(markdown, { format: 'html', standalone: true, diagramMode: 'none' });
    assert.strictEqual(format, 'html');

    const html = buffer.toString('utf8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<html'));
    assert.ok(html.includes('<body'));
  });

  test('convert() uses HTML title from front matter', async () => {
    const markdown = makeFrontMatterDoc(
      `
format: html
theme: default
title: Custom HTML Title
standalone: true
diagramMode: none
baseTag: false
      `.trim(),
      readFixture('basic.md')
    );

    const { buffer, format } = await api.convert(markdown);
    assert.strictEqual(format, 'html');
    assert.ok(buffer.toString('utf8').includes('<title>Custom HTML Title</title>'));
  });

  test('convert() returns fragment when standalone: false (front matter)', async () => {
    const markdown = makeFrontMatterDoc(
      `
format: html
theme: rainbow
standalone: false
baseTag: false
diagramMode: none
      `.trim(),
      '# HTML Fragment Test\n\nSome **bold** and *italic* text.\n'
    );

    const { buffer, format } = await api.convert(markdown);
    assert.strictEqual(format, 'html');
    const html = buffer.toString('utf8');
    assert.ok(!html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
  });

  test('diagramMode: none keeps mermaid code blocks (convertFile)', async () => {
    await withTempDir('md2x-html-diagram-none-', async (dir) => {
      const inputPath = path.join(dir, 'in.md');
      writeUtf8(inputPath, readFixture('with-diagrams.md'));

      const outputPath = path.join(dir, 'out.html');
      const result = await api.convertFile(inputPath, outputPath, { theme: 'default', diagramMode: 'none' });
      assert.strictEqual(result.format, 'html');

      const html = fs.readFileSync(outputPath, 'utf8');
      assert.ok(html.includes('language-mermaid'));
      assert.ok(!html.includes('class="md2x-diagram"'));
    });
  });

  test('diagramMode: img renders diagrams (convertFile)', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    await withTempDir('md2x-html-diagram-img-', async (dir) => {
      const inputPath = path.join(dir, 'in.md');
      writeUtf8(inputPath, readFixture('with-diagrams.md'));

      const outputPath = path.join(dir, 'out.html');
      const result = await api.convertFile(inputPath, outputPath, { theme: 'default', diagramMode: 'img' });
      assert.strictEqual(result.format, 'html');

      const html = fs.readFileSync(outputPath, 'utf8');
      assert.ok(html.includes('class="md2x-diagram"'));
    });
  });

  test('convertFile() includes live renderer bootstrap (standalone HTML)', async () => {
    await withTempDir('md2x-html-export-', async (dir) => {
      const inputPath = path.join(dir, 'doc.md');
      writeUtf8(inputPath, readFixture('with-diagrams.md'));

      const outputPath = path.join(dir, 'doc.html');
      await api.convertFile(inputPath, outputPath, { theme: 'default', diagramMode: 'live' });

      const html = fs.readFileSync(outputPath, 'utf8');
      assert.ok(html.includes('<!DOCTYPE html>'));
      assert.ok(html.includes('id="markdown-content"'));
      assert.ok(html.includes('md2x live diagram renderer (CDN)'));
      assert.ok(html.includes('__md2xRenderDocument'));
      assert.ok(html.includes('/dist/renderer/live-runtime-core.js'));
      assert.ok(!html.includes('const workerSource ='));
      assert.ok(html.includes('cdn.jsdelivr.net/npm/mermaid'));
    });
  });

  test('markdownToHtmlString liveRuntime: inline embeds required runtime sources', async () => {
    const html = await api.markdownToHtmlString('# test', {
      standalone: true,
      diagramMode: 'live',
      liveRuntime: 'inline',
    });

    assert.ok(html.includes('(runtime: inline)'));
    assert.ok(html.includes('runtimeFiles'));
    assert.ok(html.includes('live-runtime-core.js'));
    assert.ok(!html.includes('const workerSource ='));
  });

  test('preserves unescaped pipes inside inline code in GFM tables', async () => {
    const markdown = [
      '| Current condition | Duration | Longest interval |',
      '|---|---:|---:|',
      '| `|I| > 2 A` | 104.0 ms | 5.6 ms |',
    ].join('\n');

    const html = await api.markdownToHtml(markdown);
    assert.strictEqual((html.match(/<td/g) || []).length, 3);
    assert.ok(html.includes('<code>|I| > 2 A</code>'));
    assert.ok(html.includes('104.0 ms'));
    assert.ok(html.includes('5.6 ms'));
  });

  test('does not double-escape table pipes or alter pipes outside tables', async () => {
    const markdown = [
      'Inline code outside a table: `a|b`.',
      '',
      '| Expression | Value |',
      '|---|---|',
      '| `a\\|b` | 1 |',
      '',
      '```text',
      '| `fenced|code` |',
      '|---|',
      '```',
    ].join('\n');

    const html = await api.markdownToHtml(markdown);
    assert.ok(html.includes('<code>a|b</code>'));
    assert.ok(!html.includes('a\\|b'));
    assert.ok(html.includes('fenced|code'));
  });

  test('preserves code pipes in a single-column table', async () => {
    const markdown = ['| Expression |', '|---|', '| `a|b` |'].join('\n');
    const html = await api.markdownToHtml(markdown);

    assert.strictEqual((html.match(/<td/g) || []).length, 1);
    assert.ok(html.includes('<code>a|b</code>'));
  });
});

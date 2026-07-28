import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { describe, test, before } from 'node:test';

import { loadApi } from './setup.mjs';
import { readFixture } from './fixtures.mjs';
import {
  canUseBrowser,
  listZipEntries,
  makeFrontMatterDoc,
  readZipEntry,
  withTempDir,
  writeUtf8,
} from './test-utils.mjs';

let api;

before(async () => {
  api = await loadApi();
});

describe('format: docx', () => {
  test('convert() returns DOCX buffer when options.format=docx', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    const markdown = readFixture('basic.md');
    const { buffer, format } = await api.convert(markdown, { format: 'docx', theme: 'default', diagramMode: 'none' });
    assert.strictEqual(format, 'docx');
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
  });

  test('convert() uses format from front matter', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    const markdown = makeFrontMatterDoc(
      `
format: docx
theme: default
hrAsPageBreak: false
      `.trim(),
      readFixture('basic.md')
    );

    const { buffer, format } = await api.convert(markdown, { diagramMode: 'none' });
    assert.strictEqual(format, 'docx');
    assert.ok(buffer.length > 0);
  });

  test('frontMatterToOptions maps common DOCX options', () => {
    const markdown = makeFrontMatterDoc(
      `
format: docx
theme: default
hrAsPageBreak: false
      `.trim(),
      readFixture('basic.md')
    );

    const parsed = api.parseFrontMatter(markdown);
    const options = api.frontMatterToOptions(parsed.data);

    assert.strictEqual(options.format, 'docx');
    assert.strictEqual(options.hrAsPageBreak, false);
  });

  test('convertFile() uses front matter when outputPath is omitted', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    await withTempDir('md2x-docx-fm-', async (dir) => {
      const inputPath = path.join(dir, 'in.md');
      writeUtf8(
        inputPath,
        makeFrontMatterDoc(
          `
format: docx
theme: default
          `.trim(),
          readFixture('basic.md')
        )
      );

      const result = await api.convertFile(inputPath);
      assert.strictEqual(result.format, 'docx');
      assert.ok(result.outputPath.endsWith('.docx'));
      assert.ok(fs.existsSync(result.outputPath));
      assert.ok(result.buffer.length > 0);
    });
  });

  test('convertFile() embeds relative images from a Unicode Windows path', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    await withTempDir('md2x-docx-unicode-图片-', async (dir) => {
      const assetsDir = path.join(dir, '报告附件');
      const imagePath = path.join(assetsDir, '电流.png');
      const inputPath = path.join(dir, '测试分析报告.md');
      const outputPath = path.join(dir, '测试分析报告.docx');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==',
          'base64'
        )
      );
      writeUtf8(inputPath, '# Relative image\n\n![motor current](报告附件/电流.png)\n');

      const result = await api.convertFile(inputPath, outputPath, {
        format: 'docx',
        theme: 'default',
        diagramMode: 'none',
      });

      const entries = listZipEntries(result.buffer);
      const documentXml = readZipEntry(result.buffer, 'word/document.xml').toString('utf8');
      assert.ok(entries.some((name) => name.startsWith('word/media/') && name !== 'word/media/'));
      assert.ok(!documentXml.includes('图片加载失败'));
      assert.ok(documentXml.includes('<a:blip'));
    });
  });

  test('keeps inline-code pipes and following values in one DOCX table row', async (t) => {
    if (!(await canUseBrowser(api))) return t.skip('Chromium/Puppeteer not available in this environment');
    const markdown = [
      '| Current condition | Duration | Longest interval |',
      '|---|---:|---:|',
      '| `|I| > 2 A` | 104.0 ms | 5.6 ms |',
    ].join('\n');

    const { buffer } = await api.convert(markdown, {
      format: 'docx',
      theme: 'default',
      diagramMode: 'none',
    });
    const documentXml = readZipEntry(buffer, 'word/document.xml').toString('utf8');
    const expressionIndex = documentXml.indexOf('|I| &gt; 2 A');
    assert.ok(expressionIndex >= 0);

    const rowStart = documentXml.lastIndexOf('<w:tr', expressionIndex);
    const rowEnd = documentXml.indexOf('</w:tr>', expressionIndex);
    const rowXml = documentXml.slice(rowStart, rowEnd);
    assert.strictEqual((rowXml.match(/<w:tc[ >]/g) || []).length, 3);
    assert.ok(rowXml.includes('104.0 ms'));
    assert.ok(rowXml.includes('5.6 ms'));
  });
});

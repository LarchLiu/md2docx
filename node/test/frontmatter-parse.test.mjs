import fs from 'node:fs';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import {
  loadApi,
  fmPdfPath,
  fmHtmlPath,
  fmDocxPath,
  fmInvalidPath,
  fmNonePath,
  fmEmptyPath,
} from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
});

describe('parseFrontMatter', () => {
  test('parses PDF front matter', () => {
    const content = fs.readFileSync(fmPdfPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, true);
    assert.strictEqual(parsed.data.format, 'pdf');
    assert.strictEqual(parsed.data.hrAsPageBreak, true);
    assert.strictEqual(parsed.data.pdf?.format, 'A4');
  });

  test('parses HTML front matter', () => {
    const content = fs.readFileSync(fmHtmlPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, true);
    assert.strictEqual(parsed.data.format, 'html');
    assert.strictEqual(parsed.data.title, 'Custom HTML Title');
    assert.strictEqual(parsed.data.standalone, true);
    assert.strictEqual(parsed.data.diagramMode, 'live');
    assert.strictEqual(parsed.data.baseTag, false);
  });

  test('parses DOCX front matter', () => {
    const content = fs.readFileSync(fmDocxPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, true);
    assert.strictEqual(parsed.data.format, 'docx');
    assert.strictEqual(parsed.data.hrAsPageBreak, false);
  });

  test('handles invalid YAML gracefully', () => {
    const content = fs.readFileSync(fmInvalidPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, false);
  });

  test('handles no front matter', () => {
    const content = fs.readFileSync(fmNonePath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, false);
    assert.strictEqual(parsed.content, content);
  });

  test('handles empty front matter', () => {
    const content = fs.readFileSync(fmEmptyPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    assert.strictEqual(parsed.hasFrontMatter, false);
  });
});

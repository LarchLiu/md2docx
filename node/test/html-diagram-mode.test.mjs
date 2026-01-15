import fs from 'node:fs';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import {
  loadApi,
  ensureTestFile,
  inputPath,
  htmlNoneOutputPath,
  htmlImgOutputPath,
} from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
  ensureTestFile();
});

describe('HTML diagramMode', () => {
  test('diagramMode: none keeps mermaid code blocks', async () => {
    await api.convertFile(inputPath, htmlNoneOutputPath, { theme: 'default', diagramMode: 'none' });
    const htmlNone = fs.readFileSync(htmlNoneOutputPath, 'utf8');
    assert.ok(htmlNone.includes('language-mermaid'));
    assert.ok(!htmlNone.includes('class="md2x-diagram"'));
  });

  test('diagramMode: img renders diagrams', async () => {
    await api.convertFile(inputPath, htmlImgOutputPath, { theme: 'default', diagramMode: 'img' });
    assert.ok(fs.existsSync(htmlImgOutputPath));
  });
});

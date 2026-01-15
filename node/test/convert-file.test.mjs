import fs from 'node:fs';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import {
  loadApi,
  ensureTestFile,
  inputPath,
  docxOutputPath,
  pdfOutputPath,
  htmlOutputPath,
} from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
  ensureTestFile();
});

describe('convertFile', () => {
  test('converts to DOCX', async () => {
    await api.convertFile(inputPath, docxOutputPath, { theme: 'default' });
    assert.ok(fs.existsSync(docxOutputPath));
  });

  test('converts to PDF', async () => {
    await api.convertFile(inputPath, pdfOutputPath, { theme: 'default' });
    assert.ok(fs.existsSync(pdfOutputPath));
  });

  test('converts to HTML', async () => {
    await api.convertFile(inputPath, htmlOutputPath, { theme: 'default' });
    assert.ok(fs.existsSync(htmlOutputPath));
  });
});

import fs from 'node:fs';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { loadApi, ensureTestFile, inputPath } from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
  ensureTestFile();
});

describe('convert', () => {
  test('returns buffer and format', async () => {
    const markdown = fs.readFileSync(inputPath, 'utf8');
    const { buffer, format } = await api.convert(markdown, { format: 'pdf' });
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 0);
    assert.strictEqual(format, 'pdf');
  });
});

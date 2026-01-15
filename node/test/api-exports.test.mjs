import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { loadApi, PACKAGE_NAME } from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
  console.log('imported:', PACKAGE_NAME);
  console.log('exports:', Object.keys(api).sort().join(', '));
});

describe('API exports', () => {
  test('convertFile is exported', () => {
    assert.strictEqual(typeof api.convertFile, 'function');
  });

  test('convert is exported', () => {
    assert.strictEqual(typeof api.convert, 'function');
  });

  test('parseFrontMatter is exported', () => {
    assert.strictEqual(typeof api.parseFrontMatter, 'function');
  });

  test('frontMatterToOptions is exported', () => {
    assert.strictEqual(typeof api.frontMatterToOptions, 'function');
  });

  test('markdownToPdfBuffer is exported', () => {
    assert.strictEqual(typeof api.markdownToPdfBuffer, 'function');
  });

  test('markdownToDocxBuffer is exported', () => {
    assert.strictEqual(typeof api.markdownToDocxBuffer, 'function');
  });

  test('markdownToHtmlString is exported', () => {
    assert.strictEqual(typeof api.markdownToHtmlString, 'function');
  });

  test('markdownToHtmlBuffer is exported', () => {
    assert.strictEqual(typeof api.markdownToHtmlBuffer, 'function');
  });
});

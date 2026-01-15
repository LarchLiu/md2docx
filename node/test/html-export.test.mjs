import fs from 'node:fs';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import {
  loadApi,
  ensureTestFile,
  inputPath,
  htmlOutputPath,
} from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
  ensureTestFile();
  // Ensure HTML file exists
  if (!fs.existsSync(htmlOutputPath)) {
    await api.convertFile(inputPath, htmlOutputPath, { theme: 'default' });
  }
});

describe('HTML export', () => {
  test('produces standalone document', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('id="markdown-content"'));
  });

  test('includes CDN renderer bootstrap', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('md2x live diagram renderer (CDN)'));
  });

  test('references Mermaid CDN', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('cdn.jsdelivr.net/npm/mermaid'));
  });

  test('references Graphviz CDN', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(
      html.includes('cdn.jsdelivr.net/npm/@viz-js/viz') ||
      html.includes('cdn.jsdelivr.net/npm/viz.js')
    );
  });

  test('references Vega-Embed CDN', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('cdn.jsdelivr.net/npm/vega-embed'));
  });

  test('references AntV Infographic CDN', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('cdn.jsdelivr.net/npm/@antv/infographic'));
  });

  test('includes Vega-Lite v5 CDN mapping', () => {
    const html = fs.readFileSync(htmlOutputPath, 'utf8');
    assert.ok(html.includes('vega-lite@5'));
    assert.ok(html.includes('vega-embed@6'));
  });
});

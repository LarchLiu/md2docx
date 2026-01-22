import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readFixture } from './fixtures.mjs';
import { writeUtf8, outDir } from './test-utils.mjs';

test('core-worker runs in Node worker_threads and renders full fixture (standalone HTML + templates)', async () => {
  const md = readFixture('full.md');
  const options = {
    title: 'Full Test',
    theme: 'water',
    liveDiagrams: true,
  };

  const workerPath = fileURLToPath(new URL('./workers/core-worker-thread.mjs', import.meta.url));
  const worker = new Worker(pathToFileURL(workerPath), { type: 'module' });

  const result = await new Promise((resolve, reject) => {
    const onMessage = (msg) => resolve(msg);
    const onError = (err) => reject(err);
    const onExit = (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage({ md, options });
  });

  try {
    assert.ok(result && result.ok, result && result.error ? result.error : 'worker returned ok=false');
    assert.strictEqual(typeof result.html, 'string');
  } finally {
    worker.terminate().catch(() => {});
  }

  const html = result.html;

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Full Test</title>'));
  assert.ok(html.includes('md2x live diagram renderer (CDN)'));
  assert.ok(html.includes('live-runtime-core.js'));

  // Templates are collected from markdown fences and embedded into the live bootstrap JSON.
  assert.ok(html.includes('md2xTemplateFiles'));
  assert.ok(html.includes('"vue/example.vue"'));
  assert.ok(html.includes('"svelte/example.svelte"'));
  assert.ok(html.includes('"html/example.html"'));
  assert.ok(html.includes('"vue/mapLibre.vue"'));

  const outPath = path.join(outDir, 'core-worker-node.html');
  writeUtf8(outPath, html);
  assert.ok(fs.existsSync(outPath));
});

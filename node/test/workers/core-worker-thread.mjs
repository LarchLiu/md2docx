import { parentPort } from 'node:worker_threads';

import { markdownToStandaloneHtml } from '../../dist/core-worker.js';

if (!parentPort) {
  throw new Error('Missing parentPort (not running in a worker thread)');
}

parentPort.on('message', async (msg) => {
  try {
    const md = msg && typeof msg.md === 'string' ? msg.md : '';
    const options = msg && typeof msg.options === 'object' && msg.options ? msg.options : {};
    const html = await markdownToStandaloneHtml(md, options);
    parentPort.postMessage({ ok: true, html, htmlLength: html.length });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});


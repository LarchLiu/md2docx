/**
 * Build script for Node (no tsx required)
 * Compiles TypeScript and bundles the Node tool + Puppeteer renderer assets.
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const all = argv.slice();
  const watch = all.includes('--watch');
  const runIndex = all.indexOf('--run');

  if (runIndex === -1) {
    return { watch, run: false, runArgs: [] };
  }

  // Everything after `--run` is considered CLI args. If `--` is present, only take args after it.
  const afterRun = all.slice(runIndex + 1);
  const dd = afterRun.indexOf('--');
  const runArgs = dd === -1 ? afterRun : afterRun.slice(dd + 1);

  return { watch, run: true, runArgs };
}

function ensureEmptyDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function runTscDeclarations() {
  const require = createRequire(import.meta.url);
  const tscPath = require.resolve('typescript/bin/tsc');
  const tsconfigPath = path.join(__dirname, 'tsconfig.types.json');

  const child = spawn(process.execPath, [tscPath, '-p', tsconfigPath], { stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`tsc exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function writeRootTypesEntry(outDir) {
  const rel = './types/node/src/index';
  fs.writeFileSync(path.join(outDir, 'index.d.ts'), `export * from '${rel}';\n`, 'utf8');
}

async function build() {
  const { watch, run, runArgs } = parseArgs(process.argv.slice(2));
  const outDir = path.join(__dirname, 'dist');

  // Clean output directory once at startup (watch mode will incrementally rebuild).
  ensureEmptyDir(outDir);
  console.log('Building Node API types (d.ts)...');
  await runTscDeclarations();
  writeRootTypesEntry(outDir);

  try {
    let onCliEnd = () => {};
    let onApiEnd = () => {};
    let onRendererEnd = () => {};

    console.log('Building CLI...');
    const cliCtx = await esbuild.context({
      entryPoints: [path.join(__dirname, 'src/host/index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outfile: path.join(outDir, 'md2x.mjs'),
      banner: {
        js: '#!/usr/bin/env node',
      },
      plugins: [
        {
          name: 'md2x-node-runner',
          setup(build) {
            build.onEnd((result) => onCliEnd(result));
          },
        },
      ],
      external: [
        // Node.js built-ins
        'fs',
        'path',
        'url',
        'crypto',
        'util',
        'stream',
        'buffer',
        'os',
        'zlib',
        'http',
        'https',
        'events',
        'assert',
        'child_process',
        'worker_threads',
        'perf_hooks',
        // Runtime dependency
        'puppeteer',
      ],
      minify: false,
      sourcemap: false,
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });
    await cliCtx.rebuild();

    console.log('Building Node API (importable)...');
    const apiCtx = await esbuild.context({
      entryPoints: [path.join(__dirname, 'src/index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outfile: path.join(outDir, 'index.mjs'),
      plugins: [
        {
          name: 'md2x-node-api',
          setup(build) {
            build.onEnd((result) => onApiEnd(result));
          },
        },
      ],
      external: [
        // Node.js built-ins
        'fs',
        'path',
        'url',
        'crypto',
        'util',
        'stream',
        'buffer',
        'os',
        'zlib',
        'http',
        'https',
        'events',
        'assert',
        'child_process',
        'worker_threads',
        'perf_hooks',
        // Runtime dependency
        'puppeteer',
      ],
      minify: false,
      sourcemap: false,
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      logLevel: 'info',
    });
    await apiCtx.rebuild();

    // Build Puppeteer render worker (browser bundle) + HTML wrapper
    const rendererOutDir = path.join(outDir, 'renderer');
    fs.mkdirSync(rendererOutDir, { recursive: true });

    console.log('Building Puppeteer renderer...');
    const rendererCtx = await esbuild.context({
      entryPoints: {
        'puppeteer-render-worker': path.join(__dirname, 'src/webview/puppeteer-render-worker.ts'),
      },
      bundle: true,
      outdir: rendererOutDir,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120'],
      minify: true,
      sourcemap: false,
      plugins: [
        {
          name: 'md2x-renderer-assets',
          setup(build) {
            build.onEnd((result) => onRendererEnd(result));
          },
        },
      ],
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'globalThis',
      },
      inject: [path.join(rootDir, 'scripts/buffer-shim.js')],
      loader: {
        '.css': 'empty',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
        '.ttf': 'dataurl',
        '.wasm': 'file',
      },
      assetNames: 'assets/[name]-[hash]',
      logLevel: 'info',
    });
    await rendererCtx.rebuild();

    const writeRendererHtml = () => {
      // Create puppeteer-render.html (no <base>; Node sets base dynamically)
      const require = createRequire(import.meta.url);
      let mermaidJsPath = '';
      try {
        mermaidJsPath = require.resolve('mermaid/dist/mermaid.min.js');
      } catch {
        // Fallback for monorepo installs where mermaid is only at the project root.
        const fallback = path.join(rootDir, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
        if (fs.existsSync(fallback)) {
          mermaidJsPath = fallback;
        }
      }
      const mermaidJs = mermaidJsPath && fs.existsSync(mermaidJsPath) ? fs.readFileSync(mermaidJsPath, 'utf8') : '';
      const rendererHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; }
    html, body { background: white; }
    #render-container { position: absolute; left: -99999px; top: -99999px; }
  </style>
</head>
<body>
  <div id="render-container"></div>
  <canvas id="png-canvas"></canvas>
  <script>${mermaidJs}</script>
  <script src="./puppeteer-render-worker.js"></script>
</body>
</html>`;
      fs.writeFileSync(path.join(rendererOutDir, 'puppeteer-render.html'), rendererHtml);
    };
    writeRendererHtml();

    // Copy theme files
    const themesDir = path.join(rootDir, 'src/themes');
    const outThemesDir = path.join(outDir, 'themes');

    if (fs.existsSync(themesDir)) {
      copyDirSync(themesDir, outThemesDir);
      console.log('Copied themes to dist/themes');
    }

    // Make the output file executable (banner provides shebang).
    const outFile = path.join(outDir, 'md2x.mjs');
    fs.chmodSync(outFile, 0o755);

    console.log('\nBuild complete!');
    console.log(`Output: ${outFile}`);

    if (watch) {
      await cliCtx.watch();
      await apiCtx.watch();
      await rendererCtx.watch();

      const debounce = (fn, ms) => {
        let t = null;
        return () => {
          if (t) clearTimeout(t);
          t = setTimeout(fn, ms);
        };
      };

      let child = null;
      let ignoreNextCliEnd = true;
      let ignoreNextApiEnd = true;
      let ignoreNextRendererEnd = true;
      const spawnCli = () => {
        const args = runArgs.length ? runArgs : ['--help'];
        console.log(`\n[run] ${path.basename(outFile)} ${args.join(' ')}`.trim());
        child = spawn(process.execPath, [outFile, ...args], { stdio: 'inherit' });
        child.on('exit', () => {
          child = null;
        });
      };

      const restartCli = debounce(() => {
        if (!run) return;
        if (child) {
          child.kill('SIGTERM');
        }
        spawnCli();
      }, 400);

      if (run) {
        spawnCli();
      } else {
        console.log('\nWatching for changes...');
    console.log('Tip: run `node node/dist/md2x.mjs --help` in another terminal.');
      }

      onCliEnd = (result) => {
        if (!run) return;
        if (result?.errors?.length) return;
        if (ignoreNextCliEnd) {
          ignoreNextCliEnd = false;
          return;
        }
        restartCli();
      };
      onApiEnd = (result) => {
        if (!run) return;
        if (result?.errors?.length) return;
        if (ignoreNextApiEnd) {
          ignoreNextApiEnd = false;
          return;
        }
        restartCli();
      };
      onRendererEnd = (result) => {
        if (result?.errors?.length) return;
        try {
          writeRendererHtml();
        } catch {
          // ignore transient errors
        }
        if (!run) return;
        if (ignoreNextRendererEnd) {
          ignoreNextRendererEnd = false;
          return;
        }
        restartCli();
      };

      const shutdown = async () => {
        try {
          if (child) child.kill('SIGTERM');
        } catch {}
        try {
          await cliCtx.dispose();
        } catch {}
        try {
          await apiCtx.dispose();
        } catch {}
        try {
          await rendererCtx.dispose();
        } catch {}
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }

    await cliCtx.dispose();
    await apiCtx.dispose();
    await rendererCtx.dispose();
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

build();

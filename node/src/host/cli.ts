/**
 * Markdown to PDF/DOCX Node Tool - CLI Entry Point
 * Convert markdown files to PDF/DOCX/HTML/Image
 *
 * Usage:
 *   npx md2x input.md [output.pdf] [--theme <theme>]
 *   npx md2x input.md -o output.pdf --theme academic
 *   npx md2x input.md -f docx -o output.docx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Set the module directory globally for code-split chunks to use
// This must be done before any other imports that depend on it
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
(globalThis as any).__md2x_module_dir__ = __dirname;

import {
  parseFrontMatter,
  frontMatterToOptions,
  formatToExtension,
  convert,
} from './index';
import type { OutputFormat, DiagramMode } from './types';
import { registry } from './themes-data';

// Helper to get module directory
function getModuleDir(): string {
  return (globalThis as any).__md2x_module_dir__ || __dirname;
}

// ============================================================================
// CLI-specific types and functions
// ============================================================================

interface NodeOptions {
  input: string;
  output: string;
  theme: string;
  format: OutputFormat;
  help: boolean;
  version: boolean;
  listThemes: boolean;
  diagramMode: DiagramMode;
  /** Extra directories to search for md2x templates referenced by ` ```md2x ` blocks (repeatable). */
  templatesDir: string[];
  /**
   * HTML live runtime injection strategy.
   * - "inline": embed the runtime JS into the HTML (largest output, most self-contained)
   * - "cdn": reference the runtime JS from a CDN (smallest HTML output)
   */
  liveRuntime?: 'inline' | 'cdn';
  /** Custom runtime base URL when `--live-runtime cdn` */
  liveRuntimeBaseUrl?: string;
  /**
   * null means "use format default":
   * - pdf/docx: true
   * - html: false
   */
  hrPageBreak: boolean | null;
  /** Track which options were explicitly set via CLI args */
  _explicit: Set<string>;
}

function loadTemplatesFromDir(dir: string, basePath: string): Record<string, string> {
  const out: Record<string, string> = {};

  const resolveDir = (d: string): string => {
    const raw = String(d || '').trim();
    if (!raw) return '';
    try {
      if (raw.toLowerCase().startsWith('file://')) return fileURLToPath(raw);
    } catch {}
    return path.isAbsolute(raw) ? raw : path.join(basePath, raw);
  };

  const root = resolveDir(dir);
  if (!root) return out;
  if (!fs.existsSync(root)) return out;

  const walk = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }

    if (st.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(p);
      } catch {
        return;
      }
      for (const name of entries) {
        walk(path.join(p, name));
      }
      return;
    }

    if (!st.isFile()) return;

    let content = '';
    try {
      content = fs.readFileSync(p, 'utf-8');
    } catch {
      return;
    }

    const rel = path.relative(root, p);
    const relPosix = rel.split(path.sep).join('/');
    const baseName = path.basename(p);

    // Primary key: `vue/foo.vue`, `svelte/foo.svelte`, ...
    out[relPosix] = content;
    // Convenience keys for blocks that only specify the filename.
    out[baseName] = content;
    // Also expose `./...` to match blocks like `template: './vue/foo.vue'`.
    out[`./${relPosix}`] = content;
    // And file:// keys for callers that use absolute URLs.
    try {
      out[pathToFileURL(p).href] = content;
    } catch {
      // ignore
    }
  };

  walk(root);
  return out;
}

function loadTemplatesFromDirs(dirs: string[], basePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of dirs) {
    Object.assign(out, loadTemplatesFromDir(d, basePath));
  }
  return out;
}

function inferFormatFromOutputPath(outputPath: string): OutputFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.png') return 'png';
  if (ext === '.jpg') return 'jpg';
  if (ext === '.jpeg') return 'jpeg';
  if (ext === '.webp') return 'webp';
  return null;
}

function getAvailableThemes(): string[] {
  const ids = registry.themes.map((t) => t.id).sort();
  const withoutDefault = ids.filter((id) => id !== 'default');
  return ['default', ...withoutDefault];
}

function formatThemeList(themes: string[]): string {
  // Keep help output readable while still showing the complete list.
  return themes.join(', ');
}

function printHelp(): void {
  const themes = getAvailableThemes();
  console.log(`
md2x - Convert Markdown to PDF, DOCX, HTML, or Image

Usage:
  npx md2x <input.md> [output] [options]
  md2x <input.md> [output] [options]

Arguments:
  input.md          Input markdown file (required)
  output            Output file (optional, defaults to input name with .pdf/.docx/.html extension)

Options:
  -o, --output      Output file path
  -f, --format      Output format: pdf, docx, html, png, jpg/jpeg, or webp (default: "pdf")
  -t, --theme       Theme name (default: "default")
  -h, --help        Show this help message
  -v, --version     Show version number
  --diagram-mode    img | live | none (default: img for DOCX; live for HTML/Image)
  --live-runtime    inline | cdn (HTML + diagramMode=live; default: cdn)
  --live-runtime-url  Custom runtime URL when --live-runtime cdn
  --hr-page-break   Convert horizontal rules to page breaks: true | false (default: true for PDF/DOCX; false for HTML/Image)
  --templates-dir    Extra template dir for md2x blocks (repeatable; resolved against input dir when relative)
  --list-themes     List all available themes

Examples:
  npx md2x README.md
  npx md2x README.md output.pdf
  npx md2x README.md -o output.pdf --theme academic
  npx md2x README.md -f docx --hr-page-break false
  npx md2x README.md -f docx -o output.docx --theme minimal
  npx md2x README.md -f html -o output.html
  npx md2x README.md -f png -o output.png
  npx md2x --list-themes

Available Themes:
  ${formatThemeList(themes)}
`);
}

function printVersion(): void {
  // ESM-safe __dirname equivalent
  const moduleDir = getModuleDir();
  // When bundled, import.meta.url points to `node/dist/md2x.mjs`.
  // Prefer the Node package version (`node/package.json`), fall back to repo root `package.json`.
  const candidates = [path.join(moduleDir, '../package.json'), path.join(moduleDir, '../../package.json')];
  for (const packagePath of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      if (pkg?.version) {
        console.log(`md2x v${pkg.version}`);
        return;
      }
    } catch {
      // try next
    }
  }
  console.log('md2x v1.0.0');
}

function printThemes(): void {
  const themes = getAvailableThemes();
  console.log('\nAvailable Themes:\n');
  themes.forEach((theme) => {
    console.log(`  - ${theme}`);
  });
  console.log('');
}

function parseArgs(args: string[]): NodeOptions {
  const options: NodeOptions = {
    input: '',
    output: '',
    theme: 'default',
    format: 'pdf',
    help: false,
    version: false,
    listThemes: false,
    diagramMode: 'live',
    templatesDir: [],
    liveRuntime: undefined,
    liveRuntimeBaseUrl: undefined,
    hrPageBreak: null,
    _explicit: new Set(),
  };

  let i = 0;
  const positional: string[] = [];

  while (i < args.length) {
    const arg = args[i];

    // Some runners (e.g. `pnpm run <script> -- ...`) forward a literal `--` to the program.
    // We don't use `--` as a meaningful token, so just ignore it.
    if (arg === '--') {
      i++;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '--list-themes') {
      options.listThemes = true;
    } else if (arg === '--diagram-mode') {
      i++;
      if (i < args.length) {
        const mode = String(args[i]).toLowerCase();
        if (mode !== 'img' && mode !== 'live' && mode !== 'none') {
          console.error(`Error: Invalid --diagram-mode "${args[i]}". Must be "img", "live", or "none".`);
          process.exit(1);
        }
        options.diagramMode = mode as NodeOptions['diagramMode'];
        options._explicit.add('diagramMode');
      } else {
        console.error('Error: --diagram-mode requires a value (img | live | none)');
        process.exit(1);
      }
    } else if (arg === '-o' || arg === '--output') {
      i++;
      if (i < args.length) {
        options.output = args[i];
      } else {
        console.error('Error: --output requires a file path');
        process.exit(1);
      }
    } else if (arg === '-t' || arg === '--theme') {
      i++;
      if (i < args.length) {
        options.theme = args[i];
        options._explicit.add('theme');
      } else {
        console.error('Error: --theme requires a theme name');
        process.exit(1);
      }
    } else if (arg === '-f' || arg === '--format') {
      i++;
      if (i < args.length) {
        const fmt = args[i].toLowerCase();
        if (fmt !== 'pdf' && fmt !== 'docx' && fmt !== 'html' && fmt !== 'png' && fmt !== 'jpg' && fmt !== 'jpeg' && fmt !== 'webp') {
          console.error(`Error: Invalid format "${args[i]}". Must be "pdf", "docx", "html", "png", "jpg/jpeg", or "webp".`);
          process.exit(1);
        }
        options.format = fmt as OutputFormat;
        options._explicit.add('format');
      } else {
        console.error('Error: --format requires a format (pdf, docx, html, png, jpg/jpeg, or webp)');
        process.exit(1);
      }
    } else if (arg === '--hr-page-break') {
      i++;
      if (i < args.length) {
        const val = args[i].toLowerCase();
        if (val !== 'true' && val !== 'false') {
          console.error(`Error: Invalid --hr-page-break "${args[i]}". Must be "true" or "false".`);
          process.exit(1);
        }
        options.hrPageBreak = val === 'true';
        options._explicit.add('hrPageBreak');
      } else {
        console.error('Error: --hr-page-break requires a value (true | false)');
        process.exit(1);
      }
    } else if (arg === '--templates-dir') {
      i++;
      if (i < args.length) {
        const dir = String(args[i]).trim();
        if (!dir) {
          console.error('Error: --templates-dir requires a non-empty path');
          process.exit(1);
        }
        options.templatesDir.push(dir);
        options._explicit.add('templatesDir');
      } else {
        console.error('Error: --templates-dir requires a path');
        process.exit(1);
      }
    } else if (arg === '--live-runtime') {
      i++;
      if (i < args.length) {
        const v = String(args[i]).toLowerCase();
        if (v !== 'inline' && v !== 'cdn') {
          console.error(`Error: Invalid --live-runtime "${args[i]}". Must be "inline" or "cdn".`);
          process.exit(1);
        }
        options.liveRuntime = v as NodeOptions['liveRuntime'];
        options._explicit.add('liveRuntime');
      } else {
        console.error('Error: --live-runtime requires a value (inline | cdn)');
        process.exit(1);
      }
    } else if (arg === '--live-runtime-url') {
      i++;
      if (i < args.length) {
        const v = String(args[i]).trim();
        if (!v) {
          console.error('Error: --live-runtime-url requires a non-empty URL');
          process.exit(1);
        }
        options.liveRuntimeBaseUrl = v;
        options._explicit.add('liveRuntimeBaseUrl');
      } else {
        console.error('Error: --live-runtime-url requires a URL');
        process.exit(1);
      }
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }

    i++;
  }

  // Handle positional arguments
  if (positional.length > 0) {
    options.input = positional[0];
  }
  if (positional.length > 1 && !options.output) {
    options.output = positional[1];
  }

  return options;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Handle help/version/list-themes
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.version) {
    printVersion();
    process.exit(0);
  }

  if (options.listThemes) {
    printThemes();
    process.exit(0);
  }

  // Validate input
  if (!options.input) {
    console.error('Error: Input file is required\n');
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(options.input);

  // Check input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Check input file is readable
  try {
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch {
    console.error(`Error: Cannot read input file: ${inputPath}`);
    process.exit(1);
  }

  // Parse front matter to get options from the markdown file
  const markdown = fs.readFileSync(inputPath, 'utf-8');
  const fm = parseFrontMatter(markdown);
  const fmOptions = fm.hasFrontMatter ? frontMatterToOptions(fm.data) : {};

  // Merge options: CLI args that are explicitly set take precedence over front matter
  const inferredFormatFromOutput = !options._explicit.has('format') && options.output
    ? inferFormatFromOutputPath(options.output)
    : null;
  const format = options._explicit.has('format')
    ? options.format
    : (fmOptions.format ?? inferredFormatFromOutput ?? options.format);
  const theme = options._explicit.has('theme') ? options.theme : (fmOptions.theme ?? options.theme);
  const isImage = format === 'png' || format === 'jpg' || format === 'jpeg' || format === 'webp';
  // CLI defaults should match help text:
  // - HTML: diagramMode defaults to "live"
  // - Image: diagramMode defaults to "live"
  // Note: "live" needs network access in the browser context (CDN scripts). Use --diagram-mode img for offline.
  const defaultDiagramMode: DiagramMode = format === 'docx' ? 'img' : 'live';
  const diagramMode = options._explicit.has('diagramMode')
    ? options.diagramMode
    : (fmOptions.diagramMode ?? defaultDiagramMode);
  const templates = options._explicit.has('templatesDir')
    ? { ...(fmOptions.templates ?? {}), ...loadTemplatesFromDirs(options.templatesDir, path.dirname(inputPath)) }
    : (fmOptions.templates ?? {});
  const liveRuntime = options._explicit.has('liveRuntime')
    ? options.liveRuntime
    : (fmOptions.liveRuntime ?? options.liveRuntime);
  const liveRuntimeBaseUrl = options._explicit.has('liveRuntimeBaseUrl')
    ? options.liveRuntimeBaseUrl
    : (fmOptions.liveRuntimeBaseUrl ?? options.liveRuntimeBaseUrl);
  const hrAsPageBreak = options._explicit.has('hrPageBreak')
    ? options.hrPageBreak!
    : (fmOptions.hrAsPageBreak ?? (format === 'html' || format === 'png' || format === 'jpg' || format === 'jpeg' || format === 'webp' ? false : true));

  // Validate theme (CLI-specific validation with helpful error messages)
  const availableThemes = getAvailableThemes();
  if (availableThemes.length > 0 && !availableThemes.includes(theme)) {
    console.error(`Error: Unknown theme: ${theme}`);
    console.error(`Available themes: ${formatThemeList(availableThemes)}`);
    console.error('Tip: run `npx md2x --list-themes` to see the full list.');
    process.exit(1);
  }

  // Print conversion info
  console.log(`Converting: ${path.basename(inputPath)}`);
  console.log(`Format: ${format.toUpperCase()}`);
  console.log(`Theme: ${theme}`);
  console.log(`HR as page break: ${hrAsPageBreak}`);
  if (format === 'pdf' || format === 'html' || format === 'png' || format === 'jpg' || format === 'jpeg' || format === 'webp') {
    console.log(`Diagram mode: ${diagramMode}`);
  }

  try {
    // Determine output path
    let outputPath = options.output;
    const outputExt = formatToExtension(format);
    if (!outputPath) {
      const inputDir = path.dirname(inputPath);
      const inputName = path.basename(inputPath, path.extname(inputPath));
      outputPath = path.join(inputDir, `${inputName}${outputExt}`);
    } else {
      outputPath = path.resolve(outputPath);
    }

    // Ensure output directory exists and write file
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Use convert() for all formats (including images).
    // For images, `convert()` may return multiple parts via `result.buffers` when `image.split` is enabled.
    const image = isImage
      ? ({
        ...(fmOptions.image ?? {}),
        type: format === 'jpg' ? 'jpeg' : format,
        // Default to auto-splitting for CLI to avoid repeated tiles on very tall pages.
        split: (fmOptions.image as any)?.split ?? 'auto',
      } as any)
      : undefined;

    const result = await convert(fm.content, {
      format,
      theme,
      diagramMode,
      hrAsPageBreak,
      basePath: path.dirname(inputPath),
      title: fmOptions.title ?? path.basename(inputPath, path.extname(inputPath)),
      pdf: fmOptions.pdf,
      standalone: fmOptions.standalone,
      baseTag: fmOptions.baseTag,
      liveRuntime,
      liveRuntimeBaseUrl,
      cdn: fmOptions.cdn,
      templates,
      image,
      skipFrontMatter: true,
    });

    if (isImage) {
      const buffers = result.buffers && result.buffers.length > 0 ? result.buffers : [result.buffer];
      if (buffers.length <= 1) {
        fs.writeFileSync(outputPath, buffers[0]);
        console.log(`Output: ${outputPath}`);
        console.log('Done!');
        return;
      }

      const base = outputPath.endsWith(outputExt) ? outputPath.slice(0, -outputExt.length) : outputPath;
      const paths: string[] = [];
      for (let i = 0; i < buffers.length; i++) {
        const part = String(i + 1).padStart(3, '0');
        const p = `${base}.part-${part}${outputExt}`;
        fs.writeFileSync(p, buffers[i]);
        paths.push(p);
      }

      console.log(`Output: ${paths[0]} (+${paths.length - 1} parts)`);
      console.log('Done!');
      return;
    }

    fs.writeFileSync(outputPath, result.buffer);
    console.log(`Output: ${outputPath}`);
    console.log('Done!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error during conversion: ${message}`);
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

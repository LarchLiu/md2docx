/**
 * Markdown to PDF/DOCX Node Tool
 * Convert markdown files to PDF or Word documents
 *
 * Usage:
 *   npx md2x input.md [output.pdf] [--theme <theme>]
 *   npx md2x input.md -o output.pdf --theme academic
 *   npx md2x input.md -f docx -o output.docx
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

type OutputFormat = 'docx' | 'pdf';

interface NodeOptions {
  input: string;
  output: string;
  theme: string;
  format: OutputFormat;
  help: boolean;
  version: boolean;
  listThemes: boolean;
  hrPageBreak: boolean;
}

function resolveThemePresetsDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // Bundled output: node/dist/themes/presets
    path.join(moduleDir, 'themes', 'presets'),
    // Dev (running TS): repo/src/themes/presets
    path.resolve(moduleDir, '../../src/themes/presets'),
    // Fallback: cwd/src/themes/presets
    path.resolve(process.cwd(), 'src/themes/presets'),
  ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        return dir;
      }
    } catch {
      // try next
    }
  }

  return null;
}

function getAvailableThemes(): string[] {
  const presetsDir = resolveThemePresetsDir();
  if (!presetsDir) {
    return ['default'];
  }

  try {
    const ids = fs
      .readdirSync(presetsDir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => d.name.replace(/\.json$/i, ''))
      .filter((id) => id.length > 0)
      .sort();

    const unique = Array.from(new Set(ids));
    const withoutDefault = unique.filter((id) => id !== 'default');
    return ['default', ...withoutDefault];
  } catch {
    return ['default'];
  }
}

function formatThemeList(themes: string[]): string {
  // Keep help output readable while still showing the complete list.
  return themes.join(', ');
}

function printHelp(): void {
  const themes = getAvailableThemes();
  console.log(`
md2x - Convert Markdown to PDF or DOCX

Usage:
  npx md2x <input.md> [output] [options]
  md2x <input.md> [output] [options]

Arguments:
  input.md          Input markdown file (required)
  output            Output file (optional, defaults to input name with .pdf/.docx extension)

Options:
  -o, --output      Output file path
  -f, --format      Output format: pdf or docx (default: "pdf")
  -t, --theme       Theme name (default: "default")
  -h, --help        Show this help message
  -v, --version     Show version number
  --hr-page-break   Convert horizontal rules (---, ***, ___) to page breaks (default: true)
  --no-hr-page-break  Keep horizontal rules as visual lines
  --list-themes     List all available themes

Examples:
  npx md2x README.md
  npx md2x README.md output.pdf
  npx md2x README.md -o output.pdf --theme academic
  npx md2x README.md -f docx --no-hr-page-break
  npx md2x README.md -f docx -o output.docx --theme minimal
  npx md2x --list-themes

Available Themes:
  ${formatThemeList(themes)}
`);
}

function printVersion(): void {
  // ESM-safe __dirname equivalent
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
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
    hrPageBreak: true,
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
      } else {
        console.error('Error: --theme requires a theme name');
        process.exit(1);
      }
    } else if (arg === '-f' || arg === '--format') {
      i++;
      if (i < args.length) {
        const fmt = args[i].toLowerCase();
        if (fmt !== 'pdf' && fmt !== 'docx') {
          console.error(`Error: Invalid format "${args[i]}". Must be "pdf" or "docx".`);
          process.exit(1);
        }
        options.format = fmt as OutputFormat;
      } else {
        console.error('Error: --format requires a format (pdf or docx)');
        process.exit(1);
      }
    } else if (arg === '--hr-page-break') {
      options.hrPageBreak = true;
    } else if (arg === '--no-hr-page-break') {
      options.hrPageBreak = false;
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

  // Validate theme
  const availableThemes = getAvailableThemes();
  if (availableThemes.length > 0 && !availableThemes.includes(options.theme)) {
    console.error(`Error: Unknown theme: ${options.theme}`);
    console.error(`Available themes: ${formatThemeList(availableThemes)}`);
    console.error('Tip: run `npx md2x --list-themes` to see the full list.');
    process.exit(1);
  }

  // Determine output path
  let outputPath = options.output;
  const outputExt = options.format === 'pdf' ? '.pdf' : '.docx';
  if (!outputPath) {
    const inputDir = path.dirname(inputPath);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    outputPath = path.join(inputDir, `${inputName}${outputExt}`);
  } else {
    outputPath = path.resolve(outputPath);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Perform conversion
  console.log(`Converting: ${path.basename(inputPath)}`);
  console.log(`Format: ${options.format.toUpperCase()}`);
  console.log(`Theme: ${options.theme}`);
  console.log(`HR as page break: ${options.hrPageBreak}`);

  try {
    if (options.format === 'pdf') {
      const { NodePdfExporter } = await import('./node-exporter');
      const exporter = new NodePdfExporter();
      await exporter.exportToFile(inputPath, outputPath, {
        theme: options.theme,
        pdfHrAsPageBreak: options.hrPageBreak,
      });
    } else {
      const { NodeDocxExporter } = await import('./node-exporter');
      const exporter = new NodeDocxExporter();
      await exporter.exportToFile(inputPath, outputPath, {
        theme: options.theme,
        docxHrAsPageBreak: options.hrPageBreak,
      });
    }

    console.log(`Output: ${outputPath}`);
    console.log('Done!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error during conversion: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

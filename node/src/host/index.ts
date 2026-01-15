/**
 * Markdown to PDF/DOCX/HTML Library API
 * Convert markdown content to various formats
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml'
import { NodeDocxExporter, NodeHtmlExporter, NodePdfExporter } from './node-exporter';
import type { Md2DocxOptions, Md2PdfOptions, Md2HtmlOptions } from './node-exporter';

// ============================================================================
// Shared types and utilities
// ============================================================================

export type OutputFormat = 'docx' | 'pdf' | 'html';

export type DiagramMode = 'img' | 'live' | 'none';

export type FrontMatterData = Record<string, unknown>;

export interface FrontMatterOptions {
  // Common options
  theme?: string;
  format?: OutputFormat;
  hrAsPageBreak?: boolean;
  // HTML-specific options
  title?: string;
  standalone?: boolean;
  diagramMode?: DiagramMode;
  baseTag?: boolean;
  cdn?: Md2HtmlOptions['cdn'];
  // PDF-specific options
  pdf?: Md2PdfOptions['pdf'];
}

export function parseFrontMatter(markdown: string): { content: string; data: FrontMatterData; hasFrontMatter: boolean } {
  const md = String(markdown);
  const fmMatch = md.match(/^---\s*[\r\n]([\s\S]*?)[\r\n](?:---|\.\.\.)\s*(?:[\r\n]([\s\S]*))?$/);
  if (!fmMatch) {
    return { content: markdown, data: {}, hasFrontMatter: false };
  }

  try {
    const data = yaml.load(fmMatch[1]) as FrontMatterData;
    const content = fmMatch[2] || '';

    const hasFrontMatter = Object.keys(data).length > 0;
    return { content, data: data as FrontMatterData, hasFrontMatter };
  } catch {
    return { content: markdown, data: {}, hasFrontMatter: false };
  }
}

export function frontMatterToOptions(data: FrontMatterData): FrontMatterOptions {
  const out: FrontMatterOptions = {};

  // Common options
  if (typeof data.theme === 'string') out.theme = data.theme;
  if (typeof data.hrAsPageBreak === 'boolean') out.hrAsPageBreak = data.hrAsPageBreak;

  if (typeof data.format === 'string') {
    const fmt = data.format.toLowerCase();
    if (fmt === 'pdf' || fmt === 'docx' || fmt === 'html') {
      out.format = fmt;
    }
  }

  // HTML-specific options
  if (typeof data.title === 'string') out.title = data.title;
  if (typeof data.standalone === 'boolean') out.standalone = data.standalone;
  if (typeof data.baseTag === 'boolean') out.baseTag = data.baseTag;

  if (typeof data.diagramMode === 'string') {
    const dm = data.diagramMode.toLowerCase();
    if (dm === 'img' || dm === 'live' || dm === 'none') {
      out.diagramMode = dm;
    }
  }

  // CDN overrides (HTML live mode)
  if (data.cdn && typeof data.cdn === 'object') {
    out.cdn = data.cdn as Md2HtmlOptions['cdn'];
  }

  // PDF-specific options
  if (data.pdf && typeof data.pdf === 'object') {
    out.pdf = data.pdf as Md2PdfOptions['pdf'];
  }

  return out;
}

// ============================================================================
// Library API functions
// ============================================================================

/** Alias for FrontMatterOptions, used as conversion options */
export type ConvertOptions = FrontMatterOptions & {
  basePath?: string;
  /** Skip front matter parsing (use when markdown is already stripped of front matter) */
  skipFrontMatter?: boolean;
};

export interface ConvertResult {
  /** Output buffer */
  buffer: Buffer;
  /** Resolved output path */
  outputPath: string;
  /** Output format used */
  format: OutputFormat;
}

export async function markdownToDocxBuffer(markdown: string, options: Md2DocxOptions = {}): Promise<Buffer> {
  const exporter = new NodeDocxExporter();
  return exporter.exportToBuffer(markdown, options);
}

export async function markdownToPdfBuffer(markdown: string, options: Md2PdfOptions = {}): Promise<Buffer> {
  const exporter = new NodePdfExporter();
  return exporter.exportToBuffer(markdown, options);
}

export async function markdownToHtmlString(markdown: string, options: Md2HtmlOptions = {}): Promise<string> {
  const exporter = new NodeHtmlExporter();
  return exporter.exportToString(markdown, options);
}

export async function markdownToHtmlBuffer(markdown: string, options: Md2HtmlOptions = {}): Promise<Buffer> {
  const exporter = new NodeHtmlExporter();
  return exporter.exportToBuffer(markdown, options);
}

function inferFormatFromPath(outputPath: string): OutputFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.html' || ext === '.htm') return 'html';
  return null;
}

/**
 * Convert markdown content to buffer with front matter support.
 *
 * @param markdown - Markdown content (may include front matter)
 * @param options - Conversion options (override front matter)
 * @returns Buffer containing the converted content
 *
 * @example
 * ```ts
 * const md = `---
 * theme: academic
 * format: pdf
 * ---
 * # Hello World
 * `;
 * const { buffer, format } = await convert(md);
 * ```
 */
export async function convert(
  markdown: string,
  options: ConvertOptions = {}
): Promise<{ buffer: Buffer; format: OutputFormat }> {
  // Skip front matter parsing if already processed by caller
  const fm = options.skipFrontMatter
    ? { content: markdown, data: {}, hasFrontMatter: false }
    : parseFrontMatter(markdown);
  const fmOptions = fm.hasFrontMatter ? frontMatterToOptions(fm.data) : {};

  const format = options.format ?? fmOptions.format ?? 'pdf';
  const theme = options.theme ?? fmOptions.theme ?? 'default';
  const diagramMode = options.diagramMode ?? fmOptions.diagramMode ?? 'live';
  const hrAsPageBreak = options.hrAsPageBreak ?? fmOptions.hrAsPageBreak ?? (format === 'html' ? false : true);
  const basePath = options.basePath ?? process.cwd();
  const markdownContent = fm.content;

  let buffer: Buffer;

  if (format === 'pdf') {
    buffer = await markdownToPdfBuffer(markdownContent, {
      theme,
      basePath,
      hrAsPageBreak,
      pdf: {
        ...options.pdf,
        ...fmOptions.pdf,
        title: options.title ?? fmOptions.title ?? 'Document',
      },
    });
  } else if (format === 'docx') {
    buffer = await markdownToDocxBuffer(markdownContent, {
      theme,
      basePath,
      hrAsPageBreak,
    });
  } else {
    buffer = await markdownToHtmlBuffer(markdownContent, {
      theme,
      basePath,
      diagramMode,
      hrAsPageBreak,
      title: options.title ?? fmOptions.title ?? 'Document',
      standalone: options.standalone ?? fmOptions.standalone,
      baseTag: options.baseTag ?? fmOptions.baseTag,
      cdn: options.cdn ?? fmOptions.cdn,
    });
  }

  return { buffer, format };
}

/**
 * Convert a markdown file to PDF/DOCX/HTML with front matter support.
 *
 * This function:
 * 1. Reads the input markdown file
 * 2. Calls convert() to process the content
 * 3. Writes the output file
 *
 * @param inputPath - Path to the input markdown file
 * @param outputPath - Path to the output file (optional, defaults to input path with appropriate extension)
 * @param options - Conversion options (override front matter)
 * @returns ConvertResult with buffer, outputPath, and format
 *
 * @example
 * ```ts
 * // Basic usage
 * await convertFile('doc.md', 'doc.pdf');
 *
 * // With options
 * await convertFile('doc.md', 'doc.pdf', { theme: 'academic' });
 *
 * // Auto-detect format from output path
 * await convertFile('doc.md', 'doc.docx');
 *
 * // Use front matter format
 * await convertFile('doc.md'); // format from front matter or defaults to pdf
 * ```
 */
export async function convertFile(
  inputPath: string,
  outputPath?: string,
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const resolvedInputPath = path.resolve(inputPath);

  if (!fs.existsSync(resolvedInputPath)) {
    throw new Error(`Input file not found: ${resolvedInputPath}`);
  }

  const markdown = fs.readFileSync(resolvedInputPath, 'utf-8');

  // Infer format from output path if not specified
  let format = options.format;
  if (!format && outputPath) {
    format = inferFormatFromPath(outputPath) ?? undefined;
  }

  // Set default title from filename for HTML
  const titleFromFile = path.basename(resolvedInputPath, path.extname(resolvedInputPath));

  // Call convert with merged options
  const result = await convert(markdown, {
    ...options,
    format,
    basePath: options.basePath ?? path.dirname(resolvedInputPath),
    title: options.title ?? titleFromFile,
  });

  // Determine output path
  let resolvedOutputPath: string;
  if (outputPath) {
    resolvedOutputPath = path.resolve(outputPath);
  } else {
    const inputDir = path.dirname(resolvedInputPath);
    const inputName = path.basename(resolvedInputPath, path.extname(resolvedInputPath));
    const outputExt = result.format === 'pdf' ? '.pdf' : result.format === 'docx' ? '.docx' : '.html';
    resolvedOutputPath = path.join(inputDir, `${inputName}${outputExt}`);
  }

  // Ensure output directory exists and write file
  const outputDir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(resolvedOutputPath, result.buffer);

  return {
    buffer: result.buffer,
    outputPath: resolvedOutputPath,
    format: result.format,
  };
}

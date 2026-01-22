/**
 * Markdown to PDF/DOCX/HTML Library API
 * Convert markdown content to various formats
 */

import * as fs from 'fs';
import * as path from 'path';
import { NodeDocxExporter, NodeHtmlExporter, NodePdfExporter, NodeImageExporter } from './node-exporter';
import type { Md2DocxOptions, Md2PdfOptions, Md2HtmlOptions, Md2ImageOptions } from './types';

// Re-export core utilities (Web Worker compatible)
export {
  parseFrontMatter,
  frontMatterToOptions,
  formatToExtension,
  isImageFormat,
  normalizeImageType,
  markdownToHtml,
  markdownToStandaloneHtml,
  detectLiveRenderTypes,
  buildLiveDiagramBootstrapCdn,
  collectMd2xTemplateFilesFromMarkdown,
} from './core';

import {
  parseFrontMatter,
  frontMatterToOptions,
  formatToExtension,
  isImageFormat,
  normalizeImageType,
} from './core';
import type { OutputFormat, DiagramMode, ConvertOptions, ConvertResult } from './types';

// ============================================================================
// Library API functions
// ============================================================================

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

export async function markdownToImageBuffer(markdown: string, options: Md2ImageOptions = {}): Promise<Buffer> {
  const exporter = new NodeImageExporter();
  return exporter.exportToBuffer(markdown, options);
}

export async function markdownToImageBuffers(markdown: string, options: Md2ImageOptions = {}): Promise<Buffer[]> {
  const exporter = new NodeImageExporter();
  return exporter.exportToBuffers(markdown, options);
}

function inferFormatFromPath(outputPath: string): OutputFormat | null {
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
  options: ConvertOptions = {},
  fileName?: string
): Promise<{ buffer: Buffer; format: OutputFormat; buffers?: Buffer[] }> {
  // Skip front matter parsing if already processed by caller
  const fm = options.skipFrontMatter
    ? { content: markdown, data: {}, hasFrontMatter: false }
    : parseFrontMatter(markdown);
  const fmOptions = fm.hasFrontMatter ? frontMatterToOptions(fm.data) : {};

  const format = options.format ?? fmOptions.format ?? 'pdf';
  const theme = options.theme ?? fmOptions.theme ?? 'default';
  // Defaults:
  // - DOCX: use "img" (offline-friendly; avoids runtime JS execution during printing)
  // - HTML/Image: use "live" unless overridden (requires CDN scripts in browser context)
  const defaultDiagramMode: DiagramMode = format === 'docx' ? 'img' : 'live';
  const diagramMode = options.diagramMode ?? fmOptions.diagramMode ?? defaultDiagramMode;
  const hrAsPageBreak = options.hrAsPageBreak ?? fmOptions.hrAsPageBreak ?? (format === 'html' || isImageFormat(format) ? false : true);
  const basePath = options.basePath ?? process.cwd();
  const title = options.title ?? fmOptions.title ?? fileName ?? 'Document'
  const markdownContent = fm.content;

  let buffer: Buffer;
  let buffers: Buffer[] | undefined;

  if (format === 'pdf') {
    buffer = await markdownToPdfBuffer(markdownContent, {
      theme,
      basePath,
      hrAsPageBreak,
      diagramMode,
      cdn: options.cdn ?? fmOptions.cdn,
      pdf: {
        ...options.pdf,
        ...fmOptions.pdf,
        title,
      },
      templates: { ...(fmOptions.templates ?? {}), ...(options.templates ?? {}) },
    });
  } else if (format === 'docx') {
    buffer = await markdownToDocxBuffer(markdownContent, {
      theme,
      basePath,
      hrAsPageBreak,
      templates: { ...(fmOptions.templates ?? {}), ...(options.templates ?? {}) },
    });
  } else if (format === 'html') {
    buffer = await markdownToHtmlBuffer(markdownContent, {
      theme,
      basePath,
      diagramMode,
      hrAsPageBreak,
      title,
      standalone: options.standalone ?? fmOptions.standalone,
      baseTag: options.baseTag ?? fmOptions.baseTag,
      liveRuntime: options.liveRuntime ?? fmOptions.liveRuntime,
      liveRuntimeBaseUrl: options.liveRuntimeBaseUrl ?? fmOptions.liveRuntimeBaseUrl,
      cdn: options.cdn ?? fmOptions.cdn,
      templates: { ...(fmOptions.templates ?? {}), ...(options.templates ?? {}) },
    });
  } else {
    const rawImageOptions = options.image ?? fmOptions.image;
    const image = rawImageOptions?.type ? rawImageOptions : { ...(rawImageOptions ?? {}), type: normalizeImageType(format) };
    // Image conversion can produce multiple parts when `image.split` is enabled.
    buffers = await markdownToImageBuffers(markdownContent, {
      theme,
      basePath,
      hrAsPageBreak,
      image,
      diagramMode,
      cdn: options.cdn ?? fmOptions.cdn,
      templates: { ...(fmOptions.templates ?? {}), ...(options.templates ?? {}) },
    });
    if (!buffers.length) {
      throw new Error('Image conversion produced no output');
    }
    buffer = buffers[0];
  }

  return { buffer, format, buffers: buffers && buffers.length > 1 ? buffers : undefined };
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

  const fileName = path.basename(resolvedInputPath, path.extname(resolvedInputPath));

  // Call convert with merged options
  const result = await convert(markdown, {
    ...options,
    format,
    basePath: options.basePath ?? path.dirname(resolvedInputPath),
    title: options.title,
  }, fileName);

  // Determine output path
  let resolvedOutputPath: string;
  if (outputPath) {
    resolvedOutputPath = path.resolve(outputPath);
  } else {
    const inputDir = path.dirname(resolvedInputPath);
    const inputName = path.basename(resolvedInputPath, path.extname(resolvedInputPath));
    const outputExt = formatToExtension(result.format);
    resolvedOutputPath = path.join(inputDir, `${inputName}${outputExt}`);
  }

  // Ensure output directory exists and write file
  const outputDir = path.dirname(resolvedOutputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  // If the conversion produced multiple image parts, write them as `<name>.part-001.png`, etc.
  if (isImageFormat(result.format) && result.buffers && result.buffers.length > 1) {
    const bufs = result.buffers;
    const outputExt = formatToExtension(result.format);
    const base = resolvedOutputPath.endsWith(outputExt) ? resolvedOutputPath.slice(0, -outputExt.length) : resolvedOutputPath;
    const outputPaths: string[] = [];
    for (let i = 0; i < bufs.length; i++) {
      const part = String(i + 1).padStart(3, '0');
      const p = `${base}.part-${part}${outputExt}`;
      fs.writeFileSync(p, bufs[i]);
      outputPaths.push(p);
    }

    return {
      buffer: bufs[0],
      buffers: bufs,
      outputPath: outputPaths[0],
      outputPaths,
      format: result.format,
    };
  }

  fs.writeFileSync(resolvedOutputPath, result.buffer);

  return {
    buffer: result.buffer,
    outputPath: resolvedOutputPath,
    format: result.format,
  };
}

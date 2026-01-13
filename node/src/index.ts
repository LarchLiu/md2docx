import type { Md2DocxOptions, Md2PdfOptions } from './host/node-exporter';
export { NodeDocxExporter, NodePdfExporter } from './host/node-exporter';
export type { Md2DocxOptions, Md2PdfOptions } from './host/node-exporter';
export type { PdfOptions } from './host/browser-renderer';

export async function markdownToDocxBuffer(markdown: string, options: Md2DocxOptions = {}): Promise<Buffer> {
  const { NodeDocxExporter } = await import('./host/node-exporter');
  const exporter = new NodeDocxExporter();
  return exporter.exportToBuffer(markdown, options);
}

export async function markdownFileToDocxFile(
  inputPath: string,
  outputPath: string,
  options: Md2DocxOptions = {}
): Promise<void> {
  const { NodeDocxExporter } = await import('./host/node-exporter');
  const exporter = new NodeDocxExporter();
  return exporter.exportToFile(inputPath, outputPath, options);
}

export async function markdownToPdfBuffer(markdown: string, options: Md2PdfOptions = {}): Promise<Buffer> {
  const { NodePdfExporter } = await import('./host/node-exporter');
  const exporter = new NodePdfExporter();
  return exporter.exportToBuffer(markdown, options);
}

export async function markdownFileToPdfFile(
  inputPath: string,
  outputPath: string,
  options: Md2PdfOptions = {}
): Promise<void> {
  const { NodePdfExporter } = await import('./host/node-exporter');
  const exporter = new NodePdfExporter();
  return exporter.exportToFile(inputPath, outputPath, options);
}

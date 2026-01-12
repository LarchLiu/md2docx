import type { Md2DocxOptions } from './host/node-exporter';
export { NodeDocxExporter } from './host/node-exporter';
export type { Md2DocxOptions } from './host/node-exporter';

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

// Re-export from host modules
export { NodeDocxExporter, NodeHtmlExporter, NodePdfExporter } from './host/node-exporter';
export type { Md2DocxOptions, Md2HtmlOptions, Md2PdfOptions } from './host/node-exporter';
export type { PdfOptions } from './host/browser-renderer';

export {
  // Types
  type OutputFormat,
  type DiagramMode,
  type FrontMatterOptions,
  type ConvertOptions,
  type ConvertResult,
  // Functions
  parseFrontMatter,
  frontMatterToOptions,
  markdownToDocxBuffer,
  markdownToPdfBuffer,
  markdownToHtmlString,
  markdownToHtmlBuffer,
  convert,
  convertFile,
} from './host/index';

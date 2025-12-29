/**
 * File Wrapper Utility
 * Wraps non-markdown file formats (mermaid, vega, etc.) into markdown format for rendering
 */

/**
 * Get the file type from extension
 * @param filePath - The file path
 * @returns The file type (mermaid, vega, vega-lite, dot, infographic, html, or markdown)
 */
export function getFileType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  
  switch (ext) {
    case 'mermaid':
      return 'mermaid';
    case 'vega':
      return 'vega';
    case 'vl':
    case 'vega-lite':
      return 'vega-lite';
    case 'gv':
    case 'dot':
      return 'dot';
    case 'infographic':
      return 'infographic';
    case 'html':
      return 'html';
    case 'md':
    case 'markdown':
    default:
      return 'markdown';
  }
}

/**
 * Wrap file content in markdown format for rendering
 * @param content - The raw file content
 * @param filePath - The file path (used to determine file type)
 * @returns The wrapped markdown content
 */
export function wrapFileContent(content: string, filePath: string): string {
  const fileType = getFileType(filePath);
  
  // If already markdown, return as-is
  if (fileType === 'markdown') {
    return content;
  }
  
  // If it's HTML, we don't support wrapping (per requirements)
  if (fileType === 'html') {
    return content;
  }
  
  // Wrap the content in appropriate code block based on file type
  return `\`\`\`${fileType}\n${content}\n\`\`\``;
}

/**
 * Check if a file type is supported based on settings
 * @param filePath - The file path
 * @param supportedExtensions - The supported extensions from settings
 * @returns Whether the file type is supported
 */
export function isFileSupportedBySettings(
  filePath: string,
  supportedExtensions?: Record<string, boolean>
): boolean {
  const fileType = getFileType(filePath);
  
  // Markdown is always supported
  if (fileType === 'markdown') {
    return true;
  }
  
  // HTML is never supported
  if (fileType === 'html') {
    return false;
  }
  
  // Check if the file type is in supported extensions
  if (!supportedExtensions) {
    // Default settings: support mermaid, vega, vega-lite, dot, infographic
    // Not supported: svg, html
    return fileType !== 'svg' && fileType !== 'html';
  }
  
  // Map file type to settings key
  const settingsKeyMap: Record<string, keyof typeof supportedExtensions> = {
    'mermaid': 'mermaid',
    'vega': 'vega',
    'vega-lite': 'vegaLite',
    'dot': 'dot',
    'infographic': 'infographic',
  };
  
  const settingsKey = settingsKeyMap[fileType];
  if (settingsKey) {
    return supportedExtensions[settingsKey] ?? false;
  }
  
  return false;
}

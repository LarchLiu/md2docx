// DOCX Image Utilities
// Functions for handling images in DOCX export

import {
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
} from 'docx';
import type { UnifiedRenderResult } from '../types/index';
import type {
  ImageBufferResult,
  DOCXImageType,
} from '../types/docx';

interface ImageDimensions {
  width: number;
  height: number;
}

interface Renderer {
  render(type: string, content: string, options?: Record<string, unknown>): Promise<{
    base64: string;
    width: number;
    height: number;
  }>;
}

type FetchImageAsBufferFunction = (url: string) => Promise<ImageBufferResult>;

/**
 * Calculate appropriate image dimensions for DOCX to fit within page constraints
 * Maximum width: 6 inches (page width with 1 inch margins on letter size)
 * Maximum height: 9.5 inches (page height with 1 inch margins on letter size)
 * @param originalWidth - Original image width in pixels
 * @param originalHeight - Original image height in pixels
 * @returns {width: number, height: number} in pixels
 */
export function calculateImageDimensions(originalWidth: number, originalHeight: number): ImageDimensions {
  const maxWidthInches = 6;    // 8.5 - 1 - 1 = 6.5, use 6 for safety
  const maxHeightInches = 9.5; // 11 - 1 - 1 = 9, use 9.5 to maximize vertical space
  const maxWidthPixels = maxWidthInches * 96;  // 96 DPI = 576 pixels
  const maxHeightPixels = maxHeightInches * 96; // 96 DPI = 912 pixels

  // If image is smaller than both max width and height, use original size
  if (originalWidth <= maxWidthPixels && originalHeight <= maxHeightPixels) {
    return { width: originalWidth, height: originalHeight };
  }

  // Calculate scaling ratios for both dimensions
  const widthRatio = maxWidthPixels / originalWidth;
  const heightRatio = maxHeightPixels / originalHeight;

  // Use the smaller ratio to ensure the image fits within both constraints
  const ratio = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio)
  };
}

/**
 * Convert unified plugin render result to DOCX elements
 * @param renderResult - Unified render result from plugin.renderToCommon()
 * @param pluginType - Plugin type for alt text
 * @returns DOCX Paragraph or ImageRun
 */
export function convertPluginResultToDOCX(renderResult: UnifiedRenderResult, pluginType = 'diagram'): Paragraph | TextRun | ImageRun {
  if (renderResult.type === 'empty') {
    return new Paragraph({
      children: [],
    });
  }

  if (renderResult.type === 'error') {
    const inline = renderResult.display.inline;
    if (inline) {
      return new TextRun({
        text: renderResult.content.text || '',
        italics: true,
        color: 'FF0000',
      });
    }
    return new Paragraph({
      children: [
        new TextRun({
          text: renderResult.content.text || '',
          italics: true,
          color: 'FF0000',
        }),
      ],
      alignment: AlignmentType.LEFT,
      spacing: { before: 240, after: 240 },
    });
  }

  if (renderResult.type === 'text') {
    const inline = renderResult.display.inline;
    const text = renderResult.content.text || '';
    if (inline) {
      return new TextRun({ text });
    }
    return new Paragraph({
      children: [new TextRun({ text })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 240, after: 240 },
    });
  }

  if (renderResult.type === 'image') {
    const { data, width, height } = renderResult.content;
    const { inline, alignment } = renderResult.display;

    // Calculate display size (1/4 of original PNG size)
    const scaledWidth = Math.round((width || 0) / 4);
    const scaledHeight = Math.round((height || 0) / 4);

    // Apply max-width and max-height constraints
    const { width: displayWidth, height: displayHeight } = calculateImageDimensions(scaledWidth, scaledHeight);

    const imageRun = new ImageRun({
      data: data!,
      transformation: {
        width: displayWidth,
        height: displayHeight,
      },
      type: 'png',
      altText: {
        title: `${pluginType} Image`,
        description: `${pluginType} image`,
        name: `${pluginType}-image`,
      },
    });

    // Return ImageRun directly for inline, or wrapped in Paragraph for block
    if (inline) {
      return imageRun;
    }

    const alignmentMap: Record<string, typeof AlignmentType.CENTER | typeof AlignmentType.RIGHT | typeof AlignmentType.LEFT> = {
      'center': AlignmentType.CENTER,
      'right': AlignmentType.RIGHT,
      'left': AlignmentType.LEFT
    };

    return new Paragraph({
      children: [imageRun],
      alignment: alignmentMap[alignment || 'center'] || AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    });
  }

  // Fallback for unknown types
  return new Paragraph({
    children: [],
  });
}

/**
 * Get image dimensions from buffer
 * @param buffer - Image buffer
 * @param contentType - Image content type
 * @returns Promise with width and height
 */
export async function getImageDimensions(buffer: Uint8Array, contentType: string): Promise<ImageDimensions> {
  const canUseDom =
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof (URL as any).createObjectURL === 'function' &&
    typeof Image !== 'undefined';

  // Browser path (Chrome/Firefox/VSCode Webview/Mobile WebView)
  if (canUseDom) {
    return await new Promise((resolve, reject) => {
      const safeArrayBuffer = buffer.slice().buffer;
      const blob = new Blob([safeArrayBuffer], { type: contentType });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.width, height: img.height });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  // Node/CLI path: parse dimensions from bytes (no DOM available).
  const bytes = buffer;

  const readU16LE = (o: number) => (bytes[o] | (bytes[o + 1] << 8)) >>> 0;
  const readU16BE = (o: number) => ((bytes[o] << 8) | bytes[o + 1]) >>> 0;
  const readU32LE = (o: number) =>
    (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  const readU32BE = (o: number) =>
    (((bytes[o] << 24) >>> 0) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;

  try {
    // PNG
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const width = readU32BE(16);
      const height = readU32BE(20);
      return { width, height };
    }

    // GIF
    if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const width = readU16LE(6);
      const height = readU16LE(8);
      return { width, height };
    }

    // BMP
    if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      const width = readU32LE(18);
      // Height can be negative (top-down BMP)
      const rawHeight = readU32LE(22);
      const height = rawHeight > 0x7fffffff ? (0x100000000 - rawHeight) : rawHeight;
      return { width, height: Math.abs(height) };
    }

    // JPEG
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        // Skip fill bytes 0xFF
        while (offset < bytes.length && bytes[offset] === 0xff) offset++;
        const marker = bytes[offset];
        offset++;

        // Standalone markers
        if (marker === 0xd9 || marker === 0xda) break;
        if (offset + 1 >= bytes.length) break;

        const segmentLength = readU16BE(offset);
        if (segmentLength < 2) break;

        // SOF markers (baseline/progressive/etc) that contain dimensions
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);

        if (isSOF && offset + 7 < bytes.length) {
          const height = readU16BE(offset + 3);
          const width = readU16BE(offset + 5);
          return { width, height };
        }

        offset += segmentLength;
      }
    }

    // WEBP (best-effort: VP8X / VP8L)
    if (
      bytes.length >= 30 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (chunkType === 'VP8X' && bytes.length >= 30) {
        const widthMinusOne = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
        const heightMinusOne = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
        return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
      }
      if (chunkType === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = readU32LE(21);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return { width, height };
      }
    }
  } catch {
    // Fall through to default
  }

  // Unknown format or parse failure; return a safe default.
  return { width: 96, height: 96 };
}

/**
 * Determine image type from content type or URL
 * @param contentType - Image content type
 * @param url - Image URL
 * @returns Image type for docx
 */
export function determineImageType(contentType: string | null, url: string): DOCXImageType {
  let imageType: DOCXImageType = 'png'; // default
  
  if (contentType) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      imageType = 'jpg';
    } else if (contentType.includes('png')) {
      imageType = 'png';
    } else if (contentType.includes('gif')) {
      imageType = 'gif';
    } else if (contentType.includes('bmp')) {
      imageType = 'bmp';
    }
  } else if (url) {
    // Fallback: determine from URL extension
    const ext = url.toLowerCase().split('.').pop()?.split('?')[0] || '';
    const extMap: Record<string, DOCXImageType> = {
      'jpg': 'jpg',
      'jpeg': 'jpg',
      'png': 'png',
      'gif': 'gif',
      'bmp': 'bmp',
    };
    if (ext in extMap) {
      imageType = extMap[ext];
    }
  }
  
  return imageType;
}

/**
 * Check if URL or content type indicates an SVG image
 * @param url - Image URL
 * @param contentType - Content type (optional)
 * @returns True if SVG
 */
export function isSvgImage(url: string, contentType: string | null = null): boolean {
  if (contentType && contentType.includes('svg')) {
    return true;
  }
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.svg') || lowerUrl.includes('image/svg+xml');
}

/**
 * Convert SVG content to PNG using renderer
 * @param svgContent - SVG content string
 * @param renderer - Renderer instance with render() method
 * @returns Promise with buffer, width, and height
 */
export async function convertSvgToPng(svgContent: string, renderer: Renderer): Promise<{ buffer: Uint8Array; width: number; height: number }> {
  // Render SVG to PNG
  const pngResult = await renderer.render('svg', svgContent, { outputFormat: 'png' });
  
  // Convert base64 to Uint8Array
  const binaryString = atob(pngResult.base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return {
    buffer: bytes,
    width: pngResult.width,
    height: pngResult.height
  };
}

/**
 * Get SVG content from URL or data URL
 * @param url - SVG URL or data URL
 * @param fetchImageAsBuffer - Function to fetch image as buffer
 * @returns SVG content string
 */
export async function getSvgContent(url: string, fetchImageAsBuffer: FetchImageAsBufferFunction): Promise<string> {
  // Handle data: URLs
  if (url.startsWith('data:image/svg+xml')) {
    const base64Match = url.match(/^data:image\/svg\+xml;base64,(.+)$/);
    if (base64Match) {
      return atob(base64Match[1]);
    }
    // Try URL encoded format
    const urlMatch = url.match(/^data:image\/svg\+xml[;,](.+)$/);
    if (urlMatch) {
      return decodeURIComponent(urlMatch[1]);
    }
    throw new Error('Unsupported SVG data URL format');
  }
  
  // Fetch SVG file (local or remote)
  const { buffer } = await fetchImageAsBuffer(url);
  return new TextDecoder().decode(buffer);
}

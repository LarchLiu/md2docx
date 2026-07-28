/**
 * Minimal Node.js PlatformAPI implementation for reusing shared src/exporters.
 *
 * This powers `src/utils/theme-manager` + `src/exporters/docx-exporter` in the Node.
 * It is intentionally small: only the parts used during DOCX export are implemented.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { PlatformAPI } from '../../../src/types/index';
import type { DocumentService, ReadFileOptions } from '../../../src/types/platform';
import type { NodePlatformOutput, CreateNodePlatformOptions, CreatedNodePlatform } from './types';
import * as themes from './themes-data';

/**
 * Get embedded theme data by path.
 * Converts paths like "themes/presets/academic.json" to the corresponding export from themes-data.ts
 */
function getEmbeddedThemeData(resourcePath: string): string | null {
  // Normalize path: remove leading slashes and "./"
  let rel = resourcePath;
  if (rel.startsWith('./')) rel = rel.slice(2);
  if (rel.startsWith('/')) rel = rel.slice(1);

  // Handle special files
  if (rel === 'themes/registry.json') {
    return JSON.stringify(themes.registry);
  }
  if (rel === 'themes/font-config.json') {
    return JSON.stringify(themes.fontConfig);
  }

  // Parse path: themes/{category}/{id}.json
  const match = rel.match(/^themes\/([^/]+)\/(.+)\.json$/);
  if (!match) return null;

  const [, category, id] = match;

  // Convert category to variable prefix (e.g., "layout-schemes" -> "layout_schemes")
  const categoryKey = category.replace(/-/g, '_');
  // Convert id to variable suffix (e.g., "light-clean" -> "light_clean")
  const idKey = id.replace(/-/g, '_');

  // Build the export name (e.g., "layout_schemes_academic")
  const exportName = `${categoryKey}_${idKey}` as keyof typeof themes;

  const data = themes[exportName];
  if (data !== undefined) {
    return JSON.stringify(data);
  }

  return null;
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

class NodeDocumentService implements DocumentService {
  public documentPath = '';
  public documentDir = '';
  public baseUrl = '';
  public needsUriRewrite = false;

  setDocumentPath(p: string, baseUrl?: string): void {
    this.documentPath = p;
    this.documentDir = path.dirname(p);
    this.baseUrl = baseUrl ?? pathToFileURL(this.documentDir + path.sep).href;
    this.needsUriRewrite = false;
  }

  resolvePath(relativePath: string): string {
    if (relativePath.startsWith('file://')) {
      const u = new URL(relativePath);
      return u.pathname;
    }
    if (path.isAbsolute(relativePath)) {
      return relativePath;
    }
    return path.resolve(this.documentDir || process.cwd(), relativePath);
  }

  toResourceUrl(absolutePath: string): string {
    return pathToFileURL(absolutePath).href;
  }

  async readFile(absolutePath: string, options?: ReadFileOptions): Promise<string> {
    const buffer = await fs.promises.readFile(absolutePath);
    if (options?.binary) {
      return buffer.toString('base64');
    }
    return buffer.toString('utf8');
  }

  async readRelativeFile(relativePath: string, options?: ReadFileOptions): Promise<string> {
    const resolved = this.resolvePath(relativePath);
    return await this.readFile(resolved, options);
  }

  async fetchRemote(url: string): Promise<Uint8Array> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const ab = await response.arrayBuffer();
    return new Uint8Array(ab);
  }
}

export function createNodePlatform(options: CreateNodePlatformOptions): CreatedNodePlatform {
  const storage = new Map<string, unknown>();
  storage.set('selectedTheme', options.selectedThemeId);

  // Store settings for exporters to read via storage.get(['markdownViewerSettings'])
  if (options.settings) {
    storage.set('markdownViewerSettings', options.settings);
  }

  let captured: Buffer | null = null;

  const documentService = new NodeDocumentService();
  // Default document path; callers should override it before exporting a file.
  documentService.setDocumentPath(path.join(process.cwd(), '__md2x__.md'));

  const platform: PlatformAPI = {
    platform: 'node',

    cache: {
      async init() {},
      async calculateHash() { return ''; },
      async generateKey() { return ''; },
      async get() { return null; },
      async set() { return false; },
      async clear() { return true; },
      async getStats() { return null; },
    },

    renderer: {
      async init() {},
      setThemeConfig() {},
      getThemeConfig() { return null; },
      async render() { throw new Error('RendererService not available in Node platform'); },
    },

    storage: {
      async get(keys: string[]) {
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (storage.has(k)) out[k] = storage.get(k);
        }
        return out;
      },
      async set(data: Record<string, unknown>) {
        for (const [k, v] of Object.entries(data)) storage.set(k, v);
      },
      async remove(keys: string[]) {
        for (const k of keys) storage.delete(k);
      },
    },

    file: {
      async download(
        blob: Blob | string,
        filename: string,
        downloadOptions?: { onProgress?: (p: { uploaded: number; total: number }) => void }
      ) {
        const buffer = typeof blob === 'string'
          ? Buffer.from(blob, 'base64')
          : Buffer.from(await blob.arrayBuffer());

        if (downloadOptions?.onProgress) {
          downloadOptions.onProgress({ uploaded: buffer.length, total: buffer.length });
        }

        if (options.output.kind === 'buffer') {
          captured = buffer;
          return;
        }

        // kind === 'file'
        ensureParentDir(filename);
        await fs.promises.writeFile(filename, buffer);
      },
    } as any,

    resource: {
      async fetch(p: string) {
        // Support "file://..." URLs for local files
        if (p.startsWith('file://')) {
          const u = new URL(p);
          return await fs.promises.readFile(u.pathname, 'utf8');
        }

        // Try to get embedded theme data first
        const embeddedData = getEmbeddedThemeData(p);
        if (embeddedData !== null) {
          return embeddedData;
        }

        // Fallback error for unknown resources
        throw new Error(
          `Unable to locate resource "${p}". Theme assets are embedded in the Node build.`
        );
      },
      getURL(p: string) {
        // The shared fetch-utils will strip the "./" prefix and call resource.fetch().
        return `./${p}`;
      },
    },

    i18n: {
      translate(key: string) { return key; },
      getUILanguage() { return 'en'; },
    },

    message: {
      async send() { return null; },
      addListener() {},
    },

    document: documentService,
  } as any;

  return {
    platform,
    getCapturedBuffer: () => captured,
  };
}

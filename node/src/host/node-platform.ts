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

export type NodePlatformOutput =
  | { kind: 'buffer' }
  | { kind: 'file' };

export type CreateNodePlatformOptions = {
  /**
   * Directory of the running Node module (e.g. node/dist when built).
   * Used to locate the `themes/` assets.
   */
  moduleDir: string;
  selectedThemeId: string;
  output: NodePlatformOutput;
};

export type CreatedNodePlatform = {
  platform: PlatformAPI;
  getCapturedBuffer: () => Buffer | null;
};

function resolveResourceBaseDir(moduleDir: string): string {
  // Built Node: node/dist/themes
  if (fs.existsSync(path.join(moduleDir, 'themes'))) {
    return moduleDir;
  }

  // Dev (running TS): repo/src/themes
  const devSrcDir = path.resolve(moduleDir, '../../src');
  if (fs.existsSync(path.join(devSrcDir, 'themes'))) {
    return devSrcDir;
  }

  // Fallback: cwd/src/themes
  const cwdSrcDir = path.resolve(process.cwd(), 'src');
  if (fs.existsSync(path.join(cwdSrcDir, 'themes'))) {
    return cwdSrcDir;
  }

  throw new Error('Unable to locate themes assets (expected themes/ directory).');
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
  const resourceBaseDir = resolveResourceBaseDir(options.moduleDir);
  const storage = new Map<string, unknown>();
  storage.set('selectedTheme', options.selectedThemeId);

  let captured: Buffer | null = null;

  const documentService = new NodeDocumentService();
  // Default document path; caller should override via DocxExporter.setBaseUrl()
  documentService.setDocumentPath(path.join(process.cwd(), '__md2docx__.md'));

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
        // Support both "themes/..." paths and "file://..." URLs.
        let rel = p;
        if (rel.startsWith('file://')) {
          const u = new URL(rel);
          return await fs.promises.readFile(u.pathname, 'utf8');
        }

        // Remove leading "./" to match fetch-utils extractAssetPath behavior.
        if (rel.startsWith('./')) rel = rel.slice(2);
        if (rel.startsWith('/')) rel = rel.slice(1);

        const abs = path.join(resourceBaseDir, rel);
        return await fs.promises.readFile(abs, 'utf8');
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

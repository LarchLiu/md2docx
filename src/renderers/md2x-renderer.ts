/**
 * md2x Renderer
 *
 * Renders ```md2x blocks to PNG images.
 *
 * Primary goal: support Node/CLI "diagramMode: img" by rendering md2x templates
 * to an image (similar to HtmlRenderer).
 *
 * Input formats:
 * - string: raw md2x config (best-effort; requires templateFiles for template lookup)
 * - object: { code, templateFiles, cdn? }
 *
 * Notes:
 * - Vue templates use runtime Vue + vue3-sfc-loader in the render worker page.
 * - Svelte templates use the Svelte compiler (loaded via CDN) to compile `.svelte` source at runtime.
 * - Template files must be provided by the host (Node) to avoid file:// fetch/CORS issues.
 */

import { BaseRenderer } from './base-renderer';
import { HtmlRenderer } from './html-renderer';
import type { RendererThemeConfig, RenderResult } from '../types/index';

export type Md2xTemplateType = 'vue' | 'html' | 'svelte';

export type Md2xTemplateConfig = {
  type: Md2xTemplateType;
  template: string;
  data?: unknown;
  /**
   * Unsafe: when true, allow templates to load extra CSS/JS URLs declared in the template header comment:
   *   <!-- TemplateConfig: {"assets":{"scripts":[...],"styles":[...]}} -->
   *
   * Intended for UMD/IIFE globals (e.g. window.dayjs), not npm-style `import`.
   */
  allowTemplateAssets?: boolean;
  /**
   * Unsafe: when true (html templates only), execute inline <script> blocks before rendering to PNG.
   * This is required because HtmlRenderer sanitizes scripts and SVG foreignObject never executes them.
   */
  allowScripts?: boolean;
};

export type Md2xDomMountResult = {
  /** Root element that contains the rendered template (sized to content). */
  root: HTMLElement;
  /** Cleanup function to unmount and remove temporary DOM nodes. */
  cleanup: () => void;
};

export type Md2xRenderInput =
  | string
  | {
      /**
       * Raw md2x code block content (JS-ish object literal).
       * Example:
       *   type: 'vue',
       *   template: 'my-component.vue',
       *   data: [{...}]
       */
      code: string;
      /**
       * Template sources keyed by:
       * - original `template` value (e.g. "my-component.vue" / "vue/my-component.vue")
       * - normalized ref (e.g. "vue/my-component.vue")
       * - absolute file:// URL (preferred)
       */
      templateFiles?: Record<string, string>;
      /**
       * Optional CDN overrides for Vue runtime and vue3-sfc-loader.
       * (Used by Node/CLI render page; browser extensions may block remote scripts.)
       */
      cdn?: {
        vue?: string;
        vueSfcLoader?: string;
        /**
         * ESM URL that exports `compile` (e.g. a `svelte/compiler` build).
         * Used for md2x Svelte templates.
         */
        svelteCompiler?: string;
        /**
         * Base URL for resolving Svelte runtime module imports (e.g. `svelte/internal`, `svelte/store`).
         * Example: "https://esm.sh/svelte@5/".
         */
        svelteBase?: string;
      };
    };

type VueGlobals = {
  createApp: (...args: any[]) => any;
  h: (...args: any[]) => any;
  nextTick: () => Promise<void>;
};

type VueSfcLoaderGlobals = {
  loadModule: (path: string, options: any) => Promise<any>;
};

export async function dynamicImport(url: string): Promise<any> {
  // Keep the import truly dynamic so bundlers don't try to resolve CDN URLs at build time.
  return await import(/* @vite-ignore */ url);
}

function normalizeUrlBase(base: string): string {
  const b = String(base || '').trim();
  if (!b) return b;
  return b.endsWith('/') ? b : `${b}/`;
}

export function normalizePkgEntryUrl(base: string): string {
  const b = String(base || '').trim();
  if (!b) return b;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

export function rewriteSvelteModuleSpecifiers(code: string, svelteBase: string): string {
  const base = normalizeUrlBase(svelteBase);
  if (!base) return code;

  const resolve = (p: string): string => {
    try {
      return new URL(p, base).href;
    } catch {
      return base + p;
    }
  };

  const isEsmSh = base.includes('esm.sh/');
  const entry = normalizePkgEntryUrl(base);
  const map: Record<string, string> = {
    'svelte': isEsmSh ? entry : resolve('src/runtime/index.js'),
    'svelte/internal': isEsmSh ? resolve('internal') : resolve('src/runtime/internal/index.js'),
    'svelte/internal/client': isEsmSh ? resolve('internal/client') : resolve('src/runtime/internal/client/index.js'),
    'svelte/internal/server': isEsmSh ? resolve('internal/server') : resolve('src/runtime/internal/server/index.js'),
    'svelte/internal/disclose-version': isEsmSh
      ? resolve('internal/disclose-version')
      : resolve('src/runtime/internal/disclose-version/index.js'),
    'svelte/store': isEsmSh ? resolve('store') : resolve('src/runtime/store/index.js'),
    'svelte/animate': isEsmSh ? resolve('animate') : resolve('src/runtime/animate/index.js'),
    'svelte/easing': isEsmSh ? resolve('easing') : resolve('src/runtime/easing/index.js'),
    'svelte/motion': isEsmSh ? resolve('motion') : resolve('src/runtime/motion/index.js'),
    'svelte/transition': isEsmSh ? resolve('transition') : resolve('src/runtime/transition/index.js'),
  };

  let out = String(code || '');
  for (const [from, to] of Object.entries(map)) {
    out = out.split(`'${from}'`).join(`'${to}'`);
    out = out.split(`"${from}"`).join(`"${to}"`);
  }

  // Catch-all for any remaining Svelte subpath imports (Svelte 5 has many internal flags subpaths).
  if (isEsmSh && entry) {
    out = out.split(`'svelte/`).join(`'${entry}/`);
    out = out.split(`"svelte/`).join(`"${entry}/`);
  }
  return out;
}

export function normalizeMd2xTemplateRef(type: string, tpl: string): string {
  const t = String(type || '').trim().toLowerCase();
  const v = String(tpl || '').trim();
  if (!t || !v) return v;
  // If user already provided a path/URL, keep it.
  if (v.includes('/') || v.includes('\\') || v.includes('://') || v.startsWith('file://')) return v;
  return `${t}/${v}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripHighlightTags(codeHtml: string): string {
  const s = String(codeHtml || '');
  // rehype-highlight wraps tokens in <span>. Only strip tags when it looks like highlighted HTML.
  // Important: md2x data strings may legitimately contain "<...>" and must be preserved.
  if (!/<span\b/i.test(s) && !/\bhljs\b/i.test(s)) return s;
  return s.replace(/<[^>]*>/g, '');
}

function insertMissingCommasBetweenProps(input: string): string {
  // Allow YAML-ish style where properties are separated by newlines instead of commas:
  //   type: 'vue'
  //   template: 'x.vue'
  //
  // We only insert commas when the next non-ws token is an identifier followed by ":".
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isIdChar = (c: string) => /[A-Za-z0-9_$-]/.test(c);

  const lastNonWsChar = (s: string): string => {
    for (let k = s.length - 1; k >= 0; k--) {
      const ch = s[k]!;
      if (!/\s/.test(ch)) return ch;
    }
    return '';
  };

  const nextLooksLikeKey = (fromIndex: number): boolean => {
    let j = fromIndex;
    while (j < input.length && /\s/.test(input[j]!)) j++;
    const ch = input[j];
    if (!ch || !isIdStart(ch)) return false;
    let p = j + 1;
    while (p < input.length && isIdChar(input[p]!)) p++;
    while (p < input.length && /\s/.test(input[p]!)) p++;
    return input[p] === ':';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      const isCRLF = ch === '\r' && input[i + 1] === '\n';
      const isNL = ch === '\n' || ch === '\r';
      if (isNL) {
        const prev = lastNonWsChar(out);
        // If previous token looks like a completed value and next looks like a "key:",
        // insert a comma before the newline.
        if (prev && !'{[,:'.includes(prev) && nextLooksLikeKey(i + 1)) {
          out += ',';
        }
        out += ch;
        if (isCRLF) {
          out += '\n';
          i++;
        }
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function removeTrailingCommas(input: string): string {
  // Remove trailing commas in objects/arrays (outside strings).
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (!inSingle && !inDouble && ch === ',') {
      // Lookahead for } or ] ignoring whitespace.
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      const next = input[j];
      if (next === '}' || next === ']') {
        continue; // drop comma
      }
    }

    out += ch;
  }

  return out;
}

function convertSingleQuotedStringsToDoubleQuotedJson(input: string): string {
  // Convert only string delimiters; escape embedded double-quotes when inside single-quoted strings.
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      out += '"';
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    if (inSingle && ch === '"') {
      out += '\\\\\"';
      continue;
    }

    out += ch;
  }

  return out;
}

function quoteUnquotedKeysForJson(input: string): string {
  // Walk outside strings and quote { key: ... } / , key: ... patterns.
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isIdChar = (c: string) => /[A-Za-z0-9_$-]/.test(c);

  while (i < input.length) {
    const ch = input[i]!;

    if (escaped) {
      out += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === '\\\\') {
      out += ch;
      escaped = true;
      i++;
      continue;
    }
    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      out += ch;
      i++;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      out += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble) {
      // Potential key position if preceded by { or , (ignoring whitespace)
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k]!)) k--;
      const prev = k >= 0 ? out[k]! : '';
      const atKeyPos = prev === '{' || prev === ',' || prev === '';

      if (atKeyPos && isIdStart(ch)) {
        // Read identifier
        let j = i + 1;
        while (j < input.length && isIdChar(input[j]!)) j++;

        // Skip whitespace to see if next is ':'
        let p = j;
        while (p < input.length && /\s/.test(input[p]!)) p++;
        if (input[p] === ':') {
          const key = input.slice(i, j);
          out += `"${key}"`;
          i = j;
          continue;
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

export function parseMd2xTemplateConfig(rawCode: string): Md2xTemplateConfig {
  const code = stripHighlightTags(String(rawCode || '').trim());
  if (!code) throw new Error('Empty md2x block');

  // Accept either a raw mapping ("type: 'vue'") or a full JSON object.
  const wrapped = insertMissingCommasBetweenProps(code.trim().startsWith('{') ? code : `{${code}\n}`);

  // First try strict JSON.
  try {
    const parsed = JSON.parse(wrapped) as unknown;
    if (!isObject(parsed)) throw new Error('md2x config must be an object');
    const type = String(parsed.type || '').trim() as Md2xTemplateType;
    const template = String(parsed.template || '').trim();
    if (!type || (type !== 'vue' && type !== 'html' && type !== 'svelte')) {
      throw new Error('md2x.type must be "vue", "html", or "svelte"');
    }
    if (!template) throw new Error('md2x.template is required');
    const allowTemplateAssets =
      typeof (parsed as any).allowTemplateAssets === 'boolean'
        ? (parsed as any).allowTemplateAssets
        : (typeof (parsed as any).allowCdn === 'boolean' ? (parsed as any).allowCdn : undefined);
    const allowScripts = typeof (parsed as any).allowScripts === 'boolean' ? (parsed as any).allowScripts : undefined;
    return { type, template, data: (parsed as any).data, allowTemplateAssets, allowScripts };
  } catch {
    // continue
  }

  // Then try a JSON-compatible transform (single quotes, unquoted keys, trailing commas).
  const jsonish = removeTrailingCommas(
    quoteUnquotedKeysForJson(convertSingleQuotedStringsToDoubleQuotedJson(wrapped))
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonish);
  } catch (e) {
    throw new Error(`Invalid md2x config (expected object literal): ${(e as Error).message}`);
  }

  if (!isObject(parsed)) {
    throw new Error('md2x config must be an object');
  }

  const type = String((parsed as any).type || '').trim() as Md2xTemplateType;
  const template = String((parsed as any).template || '').trim();
  if (!type || (type !== 'vue' && type !== 'html' && type !== 'svelte')) {
    throw new Error('md2x.type must be "vue", "html", or "svelte"');
  }
  if (!template) throw new Error('md2x.template is required');

  const allowTemplateAssets =
    typeof (parsed as any).allowTemplateAssets === 'boolean'
      ? (parsed as any).allowTemplateAssets
      : (typeof (parsed as any).allowCdn === 'boolean' ? (parsed as any).allowCdn : undefined);
  const allowScripts = typeof (parsed as any).allowScripts === 'boolean' ? (parsed as any).allowScripts : undefined;
  return { type, template, data: (parsed as any).data, allowTemplateAssets, allowScripts };
}

function jsonForInlineJs(value: unknown): string {
  // Avoid embedding literal "<" into JS/HTML contexts.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function injectTemplateData(source: string, data: unknown): string {
  const json = jsonForInlineJs(data ?? null);
  // Keep it simple and robust: treat templateData as an identifier placeholder.
  return String(source || '').split('templateData').join(`(${json})`);
}

type TemplateConfig = {
  assets?: {
    scripts?: string[];
    styles?: string[];
  };
};

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeTemplateConfig(value: unknown): TemplateConfig | null {
  if (!value || typeof value !== 'object') return null;
  const assets = (value as any).assets;
  if (!assets || typeof assets !== 'object') return null;
  const scripts = normalizeStringList((assets as any).scripts);
  const styles = normalizeStringList((assets as any).styles);
  if (!scripts.length && !styles.length) return null;
  return { assets: { scripts, styles } };
}

export function extractTemplateConfigFromHead(source: string): {
  source: string;
  templateConfig: TemplateConfig | null;
  error?: string;
} {
  const raw = String(source || '');
  if (!raw) return { source: raw, templateConfig: null };

  let i = 0;
  // BOM
  if (raw.charCodeAt(0) === 0xfeff) i = 1;
  // leading whitespace/newlines
  while (i < raw.length && /\s/.test(raw[i]!)) i++;

  if (raw.slice(i, i + 4) !== '<!--') return { source: raw, templateConfig: null };
  const end = raw.indexOf('-->', i + 4);
  if (end === -1) return { source: raw, templateConfig: null };

  const commentBody = raw.slice(i + 4, end).trim();
  const prefix = 'TemplateConfig:';
  if (!commentBody.startsWith(prefix)) return { source: raw, templateConfig: null };

  const jsonText = commentBody.slice(prefix.length).trim();

  // Strip the header comment even if parsing fails (so SFC compilers won't choke on it).
  let after = raw.slice(end + 3);
  if (after.startsWith('\r\n')) after = after.slice(2);
  else if (after.startsWith('\n') || after.startsWith('\r')) after = after.slice(1);
  const cleaned = raw.slice(0, i) + after;

  if (!jsonText) return { source: cleaned, templateConfig: null };

  try {
    const parsed = JSON.parse(jsonText);
    return { source: cleaned, templateConfig: normalizeTemplateConfig(parsed) };
  } catch (e) {
    return { source: cleaned, templateConfig: null, error: (e as Error).message };
  }
}

function resolveAssetUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  try {
    return new URL(s, document.baseURI).href;
  } catch {
    return s;
  }
}

async function loadCssOnce(href: string): Promise<void> {
  const url = resolveAssetUrl(href);
  if (!url) return;

  const esc = (globalThis as any).CSS?.escape ? (globalThis as any).CSS.escape(url) : url.replace(/"/g, '\\"');
  const existing = document.querySelector(`link[rel="stylesheet"][href="${esc}"]`) as HTMLLinkElement | null;
  if (existing) return;

  await new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

export async function loadTemplateAssets(templateConfig: TemplateConfig | null): Promise<void> {
  const scripts = normalizeStringList(templateConfig?.assets?.scripts);
  const styles = normalizeStringList(templateConfig?.assets?.styles);

  for (const href of styles) {
    await loadCssOnce(href);
  }
  for (const src of scripts) {
    await loadScriptOnce(resolveAssetUrl(src));
  }
}

async function loadScriptOnce(src: string, globalName?: string): Promise<void> {
  if (globalName) {
    const existing = (globalThis as any)[globalName];
    if (existing) return;
  }

  // If a script with this src already exists, wait for it.
  const esc = (globalThis as any).CSS?.escape ? (globalThis as any).CSS.escape(src) : src.replace(/"/g, '\\"');
  const existingEl = document.querySelector(`script[src="${esc}"]`) as HTMLScriptElement | null;
  if (existingEl) {
    if ((existingEl as any).__md2xLoaded) return;
    await new Promise<void>((resolve, reject) => {
      existingEl.addEventListener('load', () => resolve(), { once: true });
      existingEl.addEventListener('error', () => reject(new Error('Failed to load script: ' + src)), { once: true });
    });
    (existingEl as any).__md2xLoaded = true;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => {
      (s as any).__md2xLoaded = true;
      resolve();
    };
    s.onerror = () => {
      (s as any).__md2xLoaded = true;
      reject(new Error('Failed to load script: ' + src));
    };
    document.head.appendChild(s);
  });
}

export class Md2xRenderer extends BaseRenderer {
  private htmlRenderer = new HtmlRenderer();
  private vueReady: Promise<void> | null = null;
  private svelteCompilerReady: Promise<any> | null = null;

  constructor() {
    super('md2x');
  }

  protected getTemplateSource(
    templateFiles: Record<string, string> | undefined,
    type: string,
    templateRaw: string
  ): { templateRef: string; source: string | null } {
    const raw = String(templateRaw || '').trim();
    const ref = normalizeMd2xTemplateRef(type, raw);
    const files = templateFiles ?? {};

    const candidates: string[] = [];
    if (ref) candidates.push(ref);
    if (raw && raw !== ref) candidates.push(raw);
    // Try resolving relative refs against document.baseURI (useful when templateFiles uses file:// keys).
    try {
      if (ref) candidates.push(new URL(ref, document.baseURI).href);
    } catch {}
    try {
      if (raw) candidates.push(new URL(raw, document.baseURI).href);
    } catch {}

    for (const key of candidates) {
      const hit = files[key];
      if (typeof hit === 'string') return { templateRef: ref || raw, source: hit };
    }
    return { templateRef: ref || raw, source: null };
  }

  protected async ensureVueRuntime(cdn?: { vue?: string; vueSfcLoader?: string }): Promise<void> {
    if (this.vueReady) return this.vueReady;

    const vueSrc = cdn?.vue || 'https://cdn.jsdelivr.net/npm/vue/dist/vue.global.js';
    const sfcLoaderSrc = cdn?.vueSfcLoader || 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader/dist/vue3-sfc-loader.js';

    this.vueReady = (async () => {
      // vue3-sfc-loader expects Vue global build with compiler (Vue.compile available).
      await loadScriptOnce(vueSrc, 'Vue');
      await loadScriptOnce(sfcLoaderSrc, 'vue3-sfc-loader');
    })();

    return this.vueReady;
  }

  protected async ensureSvelteCompiler(cdn?: { svelteCompiler?: string }): Promise<any> {
    if (this.svelteCompilerReady) return this.svelteCompilerReady;

    const compilerSrc =
      cdn?.svelteCompiler || 'https://esm.sh/svelte@5/compiler';

    this.svelteCompilerReady = (async () => {
      return await dynamicImport(compilerSrc);
    })();

    return this.svelteCompilerReady;
  }

  private async renderAsErrorPng(message: string, themeConfig: RendererThemeConfig | null): Promise<RenderResult | null> {
    const html = `<div style="font-family: sans-serif; font-size: 12px; color: #b00020;">
  <div style="font-weight: 600; margin-bottom: 6px;">md2x render error</div>
  <pre style="white-space: pre-wrap; margin: 0;">${message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>
</div>`;
    return await this.htmlRenderer.render(html, themeConfig);
  }

  protected async runHtmlTemplateScripts(
    root: HTMLElement,
    templateFiles: Record<string, string> | undefined
  ): Promise<void> {
    // Execute scripts in document order.
    // NOTE: scripts inserted via innerHTML are inert; we need to recreate them.
    const files = templateFiles ?? {};
    const scripts = Array.from(root.querySelectorAll('script'));

    const getSrcText = (src: string): string | null => {
      const raw = String(src || '').trim();
      if (!raw) return null;
      if (typeof files[raw] === 'string') return files[raw] as string;
      try {
        const abs = new URL(raw, document.baseURI).href;
        if (typeof files[abs] === 'string') return files[abs] as string;
      } catch {}
      return null;
    };

    for (const old of scripts) {
      const parent = old.parentNode;
      if (!parent) continue;

      const typeAttr = String(old.getAttribute('type') || '').trim().toLowerCase();
      if (typeAttr === 'module') {
        throw new Error('md2x html template: <script type="module"> is not supported for PNG rendering');
      }

      const src = old.getAttribute('src');
      if (src) {
        const text = getSrcText(src);
        if (text == null) {
          throw new Error(`md2x html template: external <script src="${src}"> is not supported unless it is provided via templateFiles`);
        }
        const s = document.createElement('script');
        // Copy attributes except src/async/defer (we inline the source for deterministic execution).
        for (const attr of Array.from(old.attributes || [])) {
          const name = String(attr?.name || '');
          if (!name) continue;
          if (name === 'src' || name === 'async' || name === 'defer') continue;
          try { s.setAttribute(name, attr.value); } catch {}
        }
        s.textContent = String(text || '');
        parent.replaceChild(s, old);
        continue;
      }

      const s = document.createElement('script');
      // Copy attributes except async/defer (keep execution order deterministic).
      for (const attr of Array.from(old.attributes || [])) {
        const name = String(attr?.name || '');
        if (!name) continue;
        if (name === 'async' || name === 'defer') continue;
        try { s.setAttribute(name, attr.value); } catch {}
      }
      s.textContent = old.textContent || '';
      parent.replaceChild(s, old);
    }
  }

  private async renderHtmlTemplate(cfg: Md2xTemplateConfig, templateFiles: Record<string, string> | undefined, themeConfig: RendererThemeConfig | null): Promise<RenderResult | null> {
    const { templateRef, source } = this.getTemplateSource(templateFiles, cfg.type, cfg.template);
    if (!source) {
      return await this.renderAsErrorPng(`Missing md2x template: ${templateRef || cfg.template}`, themeConfig);
    }

    const extracted = extractTemplateConfigFromHead(source);
    if (cfg.allowTemplateAssets) {
      if (extracted.error) {
        return await this.renderAsErrorPng(`Invalid TemplateConfig JSON: ${extracted.error}`, themeConfig);
      }
      try {
        await loadTemplateAssets(extracted.templateConfig);
      } catch (e) {
        return await this.renderAsErrorPng(`Failed to load TemplateConfig assets: ${(e as Error).message}`, themeConfig);
      }
    }

    const injected = injectTemplateData(extracted.source, cfg.data);
    if (!cfg.allowScripts) {
      return await this.htmlRenderer.render(injected, themeConfig);
    }

    // Unsafe path: execute inline scripts to allow "html template with script" to render as PNG.
    const container = this.createContainer();
    container.style.cssText =
      'position: absolute; left: -9999px; top: -9999px; display: inline-block; background: transparent; padding: 0; margin: 0;';
    const mount = document.createElement('div');
    mount.style.cssText = 'display: inline-block;';
    container.appendChild(mount);

    try {
      mount.innerHTML = injected;
      await this.runHtmlTemplateScripts(mount, templateFiles);

      // We only need the post-script DOM. Drop scripts so HtmlRenderer sanitizer doesn't matter.
      for (const s of Array.from(mount.querySelectorAll('script'))) {
        try { s.remove(); } catch {}
      }

      try {
        if (typeof (globalThis as any).requestAnimationFrame === 'function') {
          await new Promise<void>((resolve) => (globalThis as any).requestAnimationFrame(() => resolve()));
        }
      } catch {}
      try {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }
      } catch {}

      return await this.htmlRenderer.render(mount.innerHTML, themeConfig);
    } finally {
      this.removeContainer(container);
    }
  }

  private async renderSvelteTemplate(
    cfg: Md2xTemplateConfig,
    templateFiles: Record<string, string> | undefined,
    cdn: { svelteCompiler?: string; svelteBase?: string } | undefined,
    themeConfig: RendererThemeConfig | null
  ): Promise<RenderResult | null> {
    const { templateRef, source } = this.getTemplateSource(templateFiles, cfg.type, cfg.template);
    if (!source) {
      return await this.renderAsErrorPng(`Missing md2x template: ${templateRef || cfg.template}`, themeConfig);
    }

    const extracted = extractTemplateConfigFromHead(source);
    if (cfg.allowTemplateAssets) {
      if (extracted.error) {
        return await this.renderAsErrorPng(`Invalid TemplateConfig JSON: ${extracted.error}`, themeConfig);
      }
      try {
        await loadTemplateAssets(extracted.templateConfig);
      } catch (e) {
        return await this.renderAsErrorPng(`Failed to load TemplateConfig assets: ${(e as Error).message}`, themeConfig);
      }
    }

    let compilerMod: any;
    try {
      compilerMod = await this.ensureSvelteCompiler(cdn);
    } catch (e) {
      return await this.renderAsErrorPng(`Svelte compiler unavailable: ${(e as Error).message}`, themeConfig);
    }

    const compileFn =
      (compilerMod as any)?.compile ||
      (compilerMod as any)?.default?.compile ||
      (compilerMod as any)?.svelte?.compile;
    if (typeof compileFn !== 'function') {
      return await this.renderAsErrorPng('Svelte compiler not available (missing compile())', themeConfig);
    }

    const patched = injectTemplateData(extracted.source, cfg.data);

    let compiled: any;
    try {
      try {
        compiled = compileFn(patched, {
          filename: templateRef || cfg.template || 'md2x.svelte',
          generate: 'client',
        });
      } catch {
        compiled = compileFn(patched, {
          filename: templateRef || cfg.template || 'md2x.svelte',
          generate: 'dom',
        });
      }
    } catch (e) {
      return await this.renderAsErrorPng(`Failed to compile Svelte template: ${(e as Error).message}`, themeConfig);
    }

    const jsCode = String(compiled?.js?.code || '');
    const cssCode = String(compiled?.css?.code || '');
    if (!jsCode.trim()) {
      return await this.renderAsErrorPng('Svelte compile returned no JS output', themeConfig);
    }

    const svelteBase = cdn?.svelteBase || 'https://esm.sh/svelte@5/';
    const moduleCode = rewriteSvelteModuleSpecifiers(jsCode, svelteBase);

    const container = this.createContainer();
    container.style.cssText =
      'position: absolute; left: -9999px; top: -9999px; display: inline-block; background: transparent; padding: 0; margin: 0;';
    const mount = document.createElement('div');
    mount.style.cssText = 'display: inline-block;';
    container.appendChild(mount);

    let instance: any = null;
    let unmountFn: ((inst: any) => void) | null = null;
    let blobUrl: string | null = null;
    try {
      try {
        blobUrl = URL.createObjectURL(new Blob([moduleCode], { type: 'text/javascript' }));
      } catch (e) {
        throw new Error('Unable to create Blob URL for compiled Svelte module: ' + (e as Error).message);
      }

      const mod = await dynamicImport(blobUrl);
      const Comp = (mod as any)?.default;
      if (typeof Comp !== 'function') {
        throw new Error('Compiled Svelte module has no default component export');
      }

      const runtime = await dynamicImport(normalizePkgEntryUrl(svelteBase));
      const mountFn = (runtime as any)?.mount;
      unmountFn = typeof (runtime as any)?.unmount === 'function' ? (runtime as any).unmount : null;
      if (typeof mountFn !== 'function') {
        throw new Error('Svelte runtime mount() not available');
      }
      instance = mountFn(Comp, { target: mount });

      try {
        if (typeof (globalThis as any).requestAnimationFrame === 'function') {
          await new Promise<void>((resolve) => (globalThis as any).requestAnimationFrame(() => resolve()));
        }
      } catch {}
      try {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }
      } catch {}

      const styleHtml = cssCode.trim() ? `<style>${cssCode}</style>` : '';
      const renderedHtml = styleHtml + mount.innerHTML;
      return await this.htmlRenderer.render(renderedHtml, themeConfig);
    } catch (e) {
      return await this.renderAsErrorPng(`Failed to render Svelte template: ${(e as Error).message}`, themeConfig);
    } finally {
      try {
        if (instance && unmountFn) {
          unmountFn(instance);
        }
      } catch {}
      try {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      } catch {}
      this.removeContainer(container);
    }
  }

  private async renderVueTemplate(
    cfg: Md2xTemplateConfig,
    templateFiles: Record<string, string> | undefined,
    cdn: { vue?: string; vueSfcLoader?: string } | undefined,
    themeConfig: RendererThemeConfig | null
  ): Promise<RenderResult | null> {
    const { templateRef, source } = this.getTemplateSource(templateFiles, cfg.type, cfg.template);
    if (!source) {
      return await this.renderAsErrorPng(`Missing md2x template: ${templateRef || cfg.template}`, themeConfig);
    }

    const extracted = extractTemplateConfigFromHead(source);

    try {
      await this.ensureVueRuntime(cdn);
    } catch (e) {
      return await this.renderAsErrorPng(`Vue runtime unavailable: ${(e as Error).message}`, themeConfig);
    }

    if (cfg.allowTemplateAssets) {
      if (extracted.error) {
        return await this.renderAsErrorPng(`Invalid TemplateConfig JSON: ${extracted.error}`, themeConfig);
      }
      try {
        await loadTemplateAssets(extracted.templateConfig);
      } catch (e) {
        return await this.renderAsErrorPng(`Failed to load TemplateConfig assets: ${(e as Error).message}`, themeConfig);
      }
    }

    const Vue = (globalThis as any).Vue as VueGlobals | undefined;
    const loader = (globalThis as any)['vue3-sfc-loader'] as VueSfcLoaderGlobals | undefined;
    if (!Vue || !loader || typeof loader.loadModule !== 'function') {
      return await this.renderAsErrorPng('Vue runtime not available (missing Vue / vue3-sfc-loader)', themeConfig);
    }

    const styles: string[] = [];
    const patchedSfc = injectTemplateData(extracted.source, cfg.data);

    const sfcKey = templateRef || cfg.template;
    const options = {
      moduleCache: { vue: Vue },
      getFile: async (url: string) => {
        // Root file: always serve the patched SFC (even if templateFiles contains the original).
        if (url === sfcKey || url.endsWith('/' + sfcKey) || url.endsWith('\\' + sfcKey)) return patchedSfc;
        // Only resolve within the provided templateFiles map.
        const files = templateFiles ?? {};
        if (typeof files[url] === 'string') return files[url];
        try {
          const abs = new URL(url, document.baseURI).href;
          if (typeof files[abs] === 'string') return files[abs];
        } catch {}
        return null;
      },
      addStyle: (textContent: string) => {
        if (typeof textContent === 'string' && textContent.trim()) {
          styles.push(textContent);
        }
      },
    };

    // Mount Vue component, then capture resulting HTML via HtmlRenderer.
    const container = this.createContainer();
    container.style.cssText = 'position: absolute; left: -9999px; top: -9999px; display: inline-block; background: transparent; padding: 0; margin: 0;';
    const mount = document.createElement('div');
    mount.style.cssText = 'display: inline-block;';
    container.appendChild(mount);

    let app: any = null;
    try {
      const component = await loader.loadModule(sfcKey, options);

      app = Vue.createApp({
        render: () => Vue.h(component),
      });

      app.mount(mount);
      try {
        await Vue.nextTick();
      } catch {}
      try {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }
      } catch {}

      const styleHtml = styles.length ? `<style>${styles.join('\\n')}</style>` : '';
      const renderedHtml = styleHtml + mount.innerHTML;
      return await this.htmlRenderer.render(renderedHtml, themeConfig);
    } finally {
      try {
        if (app && typeof app.unmount === 'function') {
          app.unmount();
        }
      } catch {}
      this.removeContainer(container);
    }
  }

  async render(input: Md2xRenderInput, themeConfig: RendererThemeConfig | null): Promise<RenderResult | null> {
    const raw = typeof input === 'string' ? input : input.code;
    this.validateInput(raw);

    const cfg = parseMd2xTemplateConfig(raw);
    const templateFiles = typeof input === 'string' ? undefined : input.templateFiles;
    const cdn = typeof input === 'string' ? undefined : input.cdn;

    if (cfg.type === 'html') {
      return await this.renderHtmlTemplate(cfg, templateFiles, themeConfig);
    }
    if (cfg.type === 'vue') {
      return await this.renderVueTemplate(cfg, templateFiles, cdn, themeConfig);
    }
    if (cfg.type === 'svelte') {
      return await this.renderSvelteTemplate(cfg, templateFiles, cdn, themeConfig);
    }

    return await this.renderAsErrorPng(`Unsupported md2x type: ${(cfg as any).type}`, themeConfig);
  }
}

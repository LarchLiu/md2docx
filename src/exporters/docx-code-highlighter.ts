// DOCX Code Highlighter
// Functions for syntax highlighting in DOCX export

import { TextRun } from 'docx';
import hljs from 'highlight.js/lib/common';
import type { DOCXThemeStyles } from '../types/docx';

export interface CodeHighlighter {
  getHighlightColor(classList: string | string[] | DOMTokenList | null): string | null;
  appendCodeTextRuns(text: string, runs: TextRun[], color: string | null): void;
  collectHighlightedRuns(node: Node, runs: TextRun[], inheritedColor?: string | null): void;
  getHighlightedRunsForCode(code: string, language: string | null | undefined): TextRun[];
}

// Default code colors
const DEFAULT_CODE_COLORS = {
  foreground: '24292E',
  colors: {} as Record<string, string>
};

// Default code character style
const DEFAULT_CODE_STYLE = {
  font: 'Consolas',
  size: 20
};

function decodeHtmlEntities(input: string): string {
  if (!input) return '';
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, ent: string) => {
    const lower = String(ent).toLowerCase();
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'amp') return '&';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';

    // Numeric entities: &#123; or &#x1f;
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return '';
        }
      }
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return '';
        }
      }
    }

    return `&${ent};`;
  });
}

function appendHighlightedRunsFromHtml(
  html: string,
  runs: TextRun[],
  getColor: (classList: string[] | null) => string | null,
  appendRuns: (text: string, target: TextRun[], color: string | null) => void,
  defaultColor: string
): void {
  const stack: string[][] = [];
  let buffer = '';

  const currentColor = (): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const c = getColor(stack[i]);
      if (c) return c;
    }
    return defaultColor;
  };

  const flush = (): void => {
    if (!buffer) return;
    const decoded = decodeHtmlEntities(buffer);
    appendRuns(decoded, runs, currentColor());
    buffer = '';
  };

  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== '<') {
      buffer += ch;
      i++;
      continue;
    }

    const end = html.indexOf('>', i + 1);
    if (end === -1) {
      // Treat remainder as text
      buffer += html.slice(i);
      break;
    }

    const rawTag = html.slice(i + 1, end).trim();
    const tag = rawTag.toLowerCase();

    // Before changing style stack, flush accumulated text with current style.
    if (tag.startsWith('span') || tag === '/span' || tag.startsWith('br')) {
      flush();
    }

    if (tag.startsWith('span')) {
      // Extract class attribute from rawTag (keep original for case)
      const m = rawTag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const classValue = (m?.[1] ?? m?.[2] ?? '').trim();
      const classes = classValue ? classValue.split(/\s+/).filter(Boolean) : [];
      stack.push(classes);
    } else if (tag === '/span') {
      stack.pop();
    } else if (tag.startsWith('br')) {
      buffer += '\n';
    } else {
      // Ignore unknown tags but keep their inner text (already handled by buffer)
    }

    i = end + 1;
  }

  flush();
}

/**
 * Create a code highlighter for DOCX export
 * @param themeStyles - Theme configuration with code colors
 * @returns Highlighter instance with methods
 */
export function createCodeHighlighter(themeStyles: DOCXThemeStyles | null): CodeHighlighter {
  // Get code colors with defaults
  const codeColors = themeStyles?.codeColors || DEFAULT_CODE_COLORS;
  const codeStyle = themeStyles?.characterStyles?.code || DEFAULT_CODE_STYLE;
  
  /**
   * Get highlight color from CSS class list
   * @param classList - CSS classes
   * @returns Hex color without # or null
   */
  function getHighlightColor(classList: string | string[] | DOMTokenList | null): string | null {
    if (!classList) {
      return null;
    }

    const tokens: string[] = Array.isArray(classList)
      ? classList
      : typeof classList === 'string'
        ? classList.split(/\s+/)
        : Array.from(classList);

    for (const rawToken of tokens) {
      if (!rawToken) {
        continue;
      }

      const token = rawToken.startsWith('hljs-') ? rawToken.slice(5) : rawToken;
      if (!token) {
        continue;
      }

      const normalized = token.replace(/-/g, '_');

      // Use theme color
      const themeColor = codeColors.colors?.[normalized];
      if (themeColor) {
        return themeColor.replace('#', '');
      }
    }

    return null;
  }

  /**
   * Append code text runs with proper formatting
   * @param text - Text content
   * @param runs - Array to append runs to
   * @param color - Hex color
   */
  function appendCodeTextRuns(text: string, runs: TextRun[], color: string | null): void {
    if (text === '') {
      return;
    }

    const segments = text.split('\n');
    const lastIndex = segments.length - 1;
    const defaultColor = codeColors.foreground;
    const appliedColor = color || defaultColor;

    // Use theme code font and size (already converted to half-points in theme-to-docx.js)
    const codeFont = codeStyle.font;
    const codeSize = codeStyle.size;

    segments.forEach((segment, index) => {
      if (segment.length > 0) {
        runs.push(new TextRun({
          text: segment,
          font: codeFont,
          size: codeSize,
          color: appliedColor,
        }));
      }

      if (index < lastIndex) {
        runs.push(new TextRun({ text: '', break: 1 }));
      }
    });
  }

  /**
   * Recursively collect runs from highlighted HTML nodes
   * @param node - DOM node
   * @param runs - Array to append runs to
   * @param inheritedColor - Inherited color from parent
   */
  function collectHighlightedRuns(node: Node, runs: TextRun[], inheritedColor: string | null = null): void {
    if (inheritedColor === null) {
      inheritedColor = codeColors.foreground;
    }
    if (!node) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      appendCodeTextRuns(node.nodeValue || '', runs, inheritedColor);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;
    const elementColor = getHighlightColor(element.classList) || inheritedColor;
    const nextColor = elementColor || inheritedColor;

    node.childNodes.forEach((child) => {
      collectHighlightedRuns(child, runs, nextColor);
    });
  }

  /**
   * Get highlighted TextRuns for code
   * @param code - Code content
   * @param language - Programming language
   * @returns Array of TextRun elements
   */
  function getHighlightedRunsForCode(code: string, language: string | null | undefined): TextRun[] {
    const runs: TextRun[] = [];
    const hasDom = (typeof document !== 'undefined') && (typeof Node !== 'undefined');

    if (!code) {
      // Use theme code font and size (already converted to half-points in theme-to-docx.js)
      const codeFont = codeStyle.font;
      const codeSize = codeStyle.size;
      const defaultColor = codeColors.foreground;

      runs.push(new TextRun({
        text: '',
        font: codeFont,
        size: codeSize,
        color: defaultColor,
      }));
      return runs;
    }

    let highlightResult: { value: string } | null = null;

    try {
      if (language && hljs.getLanguage(language)) {
        highlightResult = hljs.highlight(code, {
          language,
          ignoreIllegals: true,
        });
      } else {
        // No language specified - don't highlight (consistent with Web behavior)
        highlightResult = null;
      }
    } catch (error) {
      console.warn('Highlight error:', error);
    }

    const defaultColor = codeColors.foreground;

    // highlight.js returns HTML; parsing that requires DOM APIs.
    if (highlightResult && highlightResult.value) {
      if (hasDom) {
        const container = document.createElement('div');
        container.innerHTML = highlightResult.value;
        collectHighlightedRuns(container, runs, defaultColor);
      } else {
        // Node/CLI: parse highlight.js HTML without DOM.
        appendHighlightedRunsFromHtml(
          highlightResult.value,
          runs,
          (cls) => getHighlightColor(cls),
          appendCodeTextRuns,
          defaultColor
        );
      }
    }

    if (runs.length === 0) {
      appendCodeTextRuns(code, runs, defaultColor);
    }

    return runs;
  }

  return {
    getHighlightColor,
    appendCodeTextRuns,
    collectHighlightedRuns,
    getHighlightedRunsForCode
  };
}

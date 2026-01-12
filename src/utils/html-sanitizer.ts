/**
 * HTML Sanitizer
 * 
 * Shared utility for sanitizing HTML content and checking if it has meaningful content
 */

/**
 * Sanitize HTML content to remove dangerous elements and attributes
 * @param html - Raw HTML content
 * @returns Sanitized HTML
 */
export function sanitizeHtml(html: string): string {
  // Node/CLI environment: no DOM available. Keep it safe and non-throwing.
  if (typeof document === 'undefined') {
    return sanitizeHtmlWithoutDom(html);
  }

  try {
    const template = document.createElement('template');
    template.innerHTML = html;

    sanitizeNodeTree(template.content);

    return template.innerHTML;
  } catch (error) {
    return html;
  }
}

/**
 * Walk the node tree and remove dangerous elements/attributes
 * @param root - Root node to sanitize
 */
function sanitizeNodeTree(root: DocumentFragment | Element): void {
  const blockedTags = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO']);
  const stack: Element[] = [];

  Array.from(root.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      stack.push(child as Element);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  });

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (blockedTags.has(node.tagName)) {
      node.remove();
      continue;
    }

    // Remove event handler attributes
    const attributes = Array.from(node.attributes || []);
    for (const attr of attributes) {
      if (attr.name.startsWith('on') || (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:'))) {
        node.removeAttribute(attr.name);
      }
    }

    // Process children
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        stack.push(child as Element);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    });
  }
}

/**
 * Check if sanitized HTML has any meaningful content
 * @param sanitizedHtml - Sanitized HTML string
 * @returns True if has content, false if empty or only whitespace
 */
export function hasHtmlContent(sanitizedHtml: string): boolean {
  // Node/CLI environment: no DOM available. Use a simple heuristic.
  if (typeof document === 'undefined') {
    return hasHtmlContentWithoutDom(sanitizedHtml);
  }

  const temp = document.createElement('div');
  temp.innerHTML = sanitizedHtml;
  // Check if there's any text content or element nodes
  return temp.textContent!.trim().length > 0 || temp.querySelector('*') !== null;
}

/**
 * Sanitize HTML and check if it has content in one step
 * @param html - Raw HTML content
 * @returns Sanitized HTML and content check result
 */
export function sanitizeAndCheck(html: string): { sanitized: string; hasContent: boolean } {
  // Skip simple line breaks (only <br> tags with whitespace/nbsp)
  if (/^(?:<br\s*\/?>(?:\s|&nbsp;)*)+$/i.test(html)) {
    return { sanitized: '', hasContent: false };
  }

  const sanitized = sanitizeHtml(html);
  const hasContent = hasHtmlContent(sanitized);
  return { sanitized, hasContent };
}

function sanitizeHtmlWithoutDom(html: string): string {
  let out = html;

  // Remove HTML comments
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // Remove blocked elements entirely (tag + content)
  out = out
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[\s\S]*?<\/embed>/gi, '')
    .replace(/<audio\b[\s\S]*?<\/audio>/gi, '')
    .replace(/<video\b[\s\S]*?<\/video>/gi, '');

  // Remove inline event handlers like onclick="..."
  out = out.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Neutralize javascript: hrefs
  out = out.replace(/\shref\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, ' href="#"');

  return out;
}

function hasHtmlContentWithoutDom(html: string): boolean {
  const normalized = (html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .trim();

  if (!normalized) return false;

  // Visible text?
  const text = normalized.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return true;

  // Non-text content that still renders something
  if (/<(img|svg|table|pre|code|hr|br|math|canvas|iframe|object|embed)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

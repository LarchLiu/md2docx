// Markdown Viewer Content Script using unified + rehypeKatex + Extension Renderer
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import ExtensionRenderer from './renderer.js';
import DocxExporter from './docx-exporter.js';
import Localization, { DEFAULT_SETTING_LOCALE } from './localization.js';
import { uploadInChunks, abortUpload } from './upload-manager.js';

function initializeContentScript() {

  const translate = (key, substitutions) => Localization.translate(key, substitutions);

  // Background Cache Proxy for Content Scripts
  class BackgroundCacheManagerProxy {
    constructor() {
      this.dbName = 'MarkdownViewerCache';
      this.storeName = 'cache';
      this.dbVersion = 1;
    }

    async get(key) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'cacheOperation',
          operation: 'get',
          key: key
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response.result;
      } catch (error) {
        return null;
      }
    }

    async set(key, value, type = 'unknown') {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'cacheOperation',
          operation: 'set',
          key: key,
          value: value,
          dataType: type
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response.success;
      } catch (error) {
        return false;
      }
    }

    async clear() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'cacheOperation',
          operation: 'clear'
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response.success;
      } catch (error) {
        return false;
      }
    }

    async getStats() {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'cacheOperation',
          operation: 'getStats'
        });

        if (response.error) {
          throw new Error(response.error);
        }

        return response.result;
      } catch (error) {
        return null;
      }
    }

    // No need for initDB since background handles it
    async initDB() {
      return Promise.resolve();
    }

    async calculateHash(text) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateKey(content, type) {
      const hash = await this.calculateHash(content);
      return `${hash}_${type}`;
    }
  }

  /**
   * Restore scroll position after rendering
   * @param {number} scrollPosition - The saved scroll position to restore
   */
  function restoreScrollPosition(scrollPosition) {
    // Function to perform the scroll restoration
    const performScroll = () => {
      window.scrollTo(0, scrollPosition);
      const currentPosition = window.scrollY || window.pageYOffset;

      // Clear saved scroll position from background script after restoration
      chrome.runtime.sendMessage({
        type: 'clearScrollPosition',
        url: document.location.href
      });

      // If the position wasn't set correctly (and it's not supposed to be at top), try again after a short delay
      if (scrollPosition > 0 && Math.abs(currentPosition - scrollPosition) > 10) {
        setTimeout(() => {
          window.scrollTo(0, scrollPosition);
        }, 100);
      }
    };

    // Use requestAnimationFrame to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      // For non-zero positions, wait for images to load to ensure accurate positioning
      if (scrollPosition > 0) {
        // Check if there are images that might still be loading
        const images = document.querySelectorAll('#markdown-content img');
        const imagePromises = Array.from(images).map(img => {
          if (img.complete) {
            return Promise.resolve();
          }
          return new Promise((resolve) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve); // Resolve even on error
            // Timeout after 3 seconds to prevent infinite waiting
            setTimeout(resolve, 3000);
          });
        });

        if (imagePromises.length > 0) {
          Promise.all(imagePromises).then(() => {
            performScroll();
          });
        } else {
          performScroll();
        }
      } else {
        // For position 0 (page top), scroll immediately without waiting for images
        performScroll();
      }
    });
  }

  /**
   * Normalize math blocks in markdown text
   * Converts single-line $$...$$ to multi-line format for proper display math rendering
   * @param {string} markdown - Raw markdown content
   * @returns {string} Normalized markdown
   */
  function normalizeMathBlocks(markdown) {
    // Match single-line display math blocks: $$...$$ (not starting/ending with $$$$)
    // Pattern explanation:
    // - (?<!\$\$) - not preceded by $$
    // - \$\$ - opening $$
    // - (.+?) - formula content (non-greedy)
    // - \$\$ - closing $$
    // - (?!\$\$) - not followed by $$
    const singleLineMathRegex = /^(\s*)(?<!\$\$)\$\$(.+?)\$\$(?!\$\$)\s*$/gm;

    let mathBlocksFound = 0;

    // Replace single-line math blocks with multi-line format
    const normalized = markdown.replace(singleLineMathRegex, (match, indent, formula) => {
      mathBlocksFound++;
      // Convert to multi-line format with proper spacing
      return `\n$$\n${formula.trim()}\n$$\n`;
    });

    return normalized;
  }

  /**
   * Sanitize rendered HTML to remove active content like scripts before injection
   * @param {string} html - Raw HTML string produced by the markdown pipeline
   * @returns {string} Sanitized HTML safe for innerHTML assignment
   */
  function sanitizeRenderedHtml(html) {
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
   * @param {Node} root - Root node to sanitize
   */
  function sanitizeNodeTree(root) {
  const blockedTags = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO']);
    const stack = [];

    Array.from(root.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        stack.push(child);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    });

    while (stack.length > 0) {
      const node = stack.pop();

      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const tagName = node.tagName ? node.tagName.toUpperCase() : '';
      if (blockedTags.has(tagName)) {
  const originalMarkup = node.outerHTML || `<${tagName.toLowerCase()}>`;
  const truncatedMarkup = originalMarkup.length > 500 ? `${originalMarkup.slice(0, 500)}...` : originalMarkup;
        const warning = document.createElement('pre');
        warning.className = 'blocked-html-warning';
        warning.setAttribute('style', 'background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px; white-space: pre-wrap;');
  const message = `Blocked insecure <${tagName.toLowerCase()}> element removed.

${truncatedMarkup}`;
        warning.textContent = message;
        node.replaceWith(warning);
        continue;
      }

      sanitizeElementAttributes(node);

      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          stack.push(child);
        } else if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      });
    }
  }

  /**
   * Strip unsafe attributes from an element
   * @param {Element} element - Element to sanitize
   */
  function sanitizeElementAttributes(element) {
    if (!element.hasAttributes()) {
      return;
    }

    const urlAttributes = ['src', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset'];

    Array.from(element.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();

      if (attrName.startsWith('on')) {
        element.removeAttribute(attr.name);
        return;
      }

      if (urlAttributes.includes(attrName)) {
        if (attrName === 'srcset') {
          if (!isSafeSrcset(attr.value)) {
            element.removeAttribute(attr.name);
          }
        } else if (attrName === 'href' || attrName === 'xlink:href') {
          if (attr.value && attr.value.trim()) {
            element.setAttribute(attr.name, '#');
          } else {
            element.removeAttribute(attr.name);
          }
        } else if (!isSafeUrl(attr.value)) {
          element.removeAttribute(attr.name);
        }
      }
    });
  }

  /**
   * Validate that every URL candidate in a srcset attribute is safe
   * @param {string} value - Raw srcset value
   * @returns {boolean} True when every entry is safe
   */
  function isSafeSrcset(value) {
    if (!value) {
      return true;
    }

    return value.split(',').every((candidate) => {
      const urlPart = candidate.trim().split(/\s+/)[0];
      return isSafeUrl(urlPart);
    });
  }

  /**
   * Validate URL values and block javascript-style protocols
   * @param {string} url - URL to validate
   * @returns {boolean} True when URL is considered safe
   */
  function isSafeUrl(url) {
    if (!url) {
      return true;
    }

    const trimmed = url.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return true;
    }

    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/javascript')) {
      return false;
    }

    if (lower.startsWith('data:')) {
      return lower.startsWith('data:image/') || lower.startsWith('data:application/pdf');
    }

    try {
      const parsed = new URL(trimmed, document.baseURI);
      return ['http:', 'https:', 'mailto:', 'tel:', 'chrome-extension:', 'file:'].includes(parsed.protocol);
    } catch (error) {
      return false;
    }
  }

  // Global async task queue
  const asyncTaskQueue = [];
  let asyncTaskIdCounter = 0;

  /**
   * Generate unique ID for async tasks
   */
  function generateAsyncId() {
    return `async-placeholder-${++asyncTaskIdCounter}`;
  }

  /**
   * Register async task for later execution with status management
   * @param {Function} callback - The async callback function
   * @param {Object} data - Data to pass to callback
   * @param {string} type - Type for placeholder styling ('mermaid', 'html', 'svg')
   * @param {string} description - Optional description for placeholder
   * @param {string} initialStatus - Initial task status ('ready', 'fetching')
   * @returns {Object} - Object with task control and placeholder content
   */
  function asyncTask(callback, data = {}, type = 'unknown', description = '', initialStatus = 'ready') {
    const placeholderId = generateAsyncId();

    // Create task object with status management
    const task = {
      id: placeholderId,
      callback,
      data: { ...data, id: placeholderId },
      type,
      status: initialStatus, // 'ready', 'fetching', 'error'
      error: null,

      // Methods for business logic to update status
      setReady: () => {
        task.status = 'ready';
      },
      setError: (error) => {
        task.status = 'error';
        task.error = error;
      }
    };

    asyncTaskQueue.push(task);

    return {
      task, // Return task object for business logic control
      placeholder: {
        type: 'html',
        value: createAsyncPlaceholder(placeholderId, type, description)
      }
    };
  }

  /**
   * Create placeholder HTML for async content
   */
  function createAsyncPlaceholder(id, type, description = '') {
    const typeLabelKeys = {
      mermaid: 'async_placeholder_type_mermaid',
      html: 'async_placeholder_type_html',
      svg: 'async_placeholder_type_svg'
    };

    const typeLabelFallbacks = {
      mermaid: 'Mermaid diagram',
      html: 'HTML chart',
      svg: 'SVG image'
    };

    const typeLabelKey = typeLabelKeys[type];
    const typeLabel = typeLabelKey ? translate(typeLabelKey) : '';
    const resolvedTypeLabel = typeLabel || typeLabelFallbacks[type] || type;
    const descriptionSuffix = description ? `: ${description}` : '';
    const processingText = translate('async_processing_message', [resolvedTypeLabel, descriptionSuffix])
      || `Processing ${resolvedTypeLabel}${descriptionSuffix}...`;

    // SVG images should use inline placeholders to preserve text flow
    if (type === 'svg') {
      return `<span id="${id}" class="async-placeholder ${type}-placeholder inline-placeholder">
      <span class="async-loading">
        <span class="async-spinner"></span>
        <span class="async-text">${processingText}</span>
      </span>
    </span>`;
    }

    // Other content types use block placeholders
    return `<div id="${id}" class="async-placeholder ${type}-placeholder">
    <div class="async-loading">
      <div class="async-spinner"></div>
      <div class="async-text">${processingText}</div>
    </div>
  </div>`;
  }

  /**
   * Process all async tasks with prioritized handling
   * Priority: ready > error > fetching (wait for fetching tasks)
   */
  async function processAsyncTasks() {
    if (asyncTaskQueue.length === 0) {
      return;
    }

    const totalTasks = asyncTaskQueue.length;

    // Show processing indicator and set initial progress
    showProcessingIndicator();
    updateProgress(0, totalTasks);

    let completedTasks = 0;

    // Process tasks with priority: ready/error first, then wait for fetching
    while (asyncTaskQueue.length > 0) {
      // Find tasks that are ready to process (ready or error status)
      let readyTaskIndex = asyncTaskQueue.findIndex(task =>
        task.status === 'ready' || task.status === 'error'
      );

      if (readyTaskIndex !== -1) {
        // Process ready/error task
        const task = asyncTaskQueue.splice(readyTaskIndex, 1)[0];

        try {
          if (task.status === 'error') {
            // Handle error case - update placeholder with error message
            const placeholder = document.getElementById(task.id);
            if (placeholder) {
              const unknownError = translate('async_unknown_error');
              const errorDetail = escapeHtml((task.error ? task.error.message : '') || unknownError);
              const localizedError = translate('async_processing_error', [errorDetail]);
              placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">${localizedError}</pre>`;
            }
          } else {
            // Process ready task normally
            await Promise.resolve().then(() => task.callback(task.data));
          }

          completedTasks++;
          updateProgress(completedTasks, totalTasks);

        } catch (error) {
          console.error('Async task processing error:', error);
          // Update placeholder with error message
          const placeholder = document.getElementById(task.id);
          if (placeholder) {
            const errorDetail = escapeHtml(error.message || '');
            const localizedError = translate('async_task_processing_error', [errorDetail]);
            placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">${localizedError}</pre>`;
          }

          completedTasks++;
          updateProgress(completedTasks, totalTasks);
        }
      } else {
        // All remaining tasks are fetching, wait a bit and check again
        const fetchingTasks = asyncTaskQueue.filter(task => task.status === 'fetching');

        if (fetchingTasks.length === 0) {
          // No more tasks to process (shouldn't happen), break the loop
          break;
        }

        // Wait 100ms before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Hide processing indicator when all tasks are done
    hideProcessingIndicator();
  }

  /**
   * Update progress circle based on completed vs total tasks
   */
  function updateProgress(completed, total) {
    const progressCircle = document.querySelector('.progress-circle-progress');
    if (!progressCircle) return;

    // Calculate progress percentage
    const progress = completed / total;
    const circumference = 43.98; // 2 * PI * 7 (radius)

    // Calculate stroke-dashoffset (starts at full circle, decreases as progress increases)
    const offset = circumference * (1 - progress);

    progressCircle.style.strokeDashoffset = offset;
  }

  /**
   * Show processing indicator in TOC header
   */
  function showProcessingIndicator() {
    const indicator = document.getElementById('processing-indicator');

    if (indicator) {
      indicator.classList.remove('hidden');
    }
  }

  /**
   * Hide processing indicator in TOC header
   */
  function hideProcessingIndicator() {
    const indicator = document.getElementById('processing-indicator');
    if (indicator) {
      indicator.classList.add('hidden');
    }
  }/**
 * Remark plugin to convert Mermaid code blocks to PNG (async callback version)
 */
  function remarkMermaidToPng(renderer) {
    return function () {
      return (tree) => {
        // Collect all mermaid code blocks
        visit(tree, 'code', (node, index, parent) => {
          if (node.lang === 'mermaid') {
            // Create async task for Mermaid processing
            // Mermaid code is embedded data, so it's ready immediately
            const result = asyncTask(async (data) => {
              const { id, code } = data;
              try {
                const pngResult = await renderer.renderMermaidToPng(code);
                const placeholder = document.getElementById(id);
                if (placeholder) {
                  // Calculate display size (1/4 of original PNG size)
                  const displayWidth = Math.round(pngResult.width / 4);
                  placeholder.outerHTML = `<div class="mermaid-diagram" style="text-align: center; margin: 20px 0;">
                  <img src="data:image/png;base64,${pngResult.base64}" alt="Mermaid diagram" width="${displayWidth}px" />
                </div>`;
                }
              } catch (error) {
                const placeholder = document.getElementById(id);
                if (placeholder) {
                  const errorDetail = escapeHtml(error.message || '');
                  const localizedError = translate('async_mermaid_error', [errorDetail])
                    || `Mermaid error: ${errorDetail}`;
                  placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">${localizedError}</pre>`;
                }
              }
            }, { code: node.value }, 'mermaid', '', 'ready'); // Embedded code is ready immediately

            // Replace code block with placeholder
            parent.children[index] = result.placeholder;
          }
        });
      };
    };
  }

  /**
   * Remark plugin to convert HTML blocks to PNG (async callback version)
   */
  function remarkHtmlToPng(renderer) {
    return function () {
      return (tree) => {
        // Collect all significant HTML nodes
        visit(tree, 'html', (node, index, parent) => {
          const htmlContent = node.value.trim();
          if (!htmlContent) {
            return;
          }

          if (/^(?:<br\s*\/?>(?:\s|&nbsp;)*)+$/i.test(htmlContent)) {
            return;
          }

          const sanitizedHtml = sanitizeRenderedHtml(htmlContent);
          if (!sanitizedHtml || sanitizedHtml.replace(/\s+/g, '').length <= 0) {
            return;
          }

          const result = asyncTask(async (data) => {
            const { id, code } = data;
            try {
              const pngResult = await renderer.renderHtmlToPng(code);
              const placeholder = document.getElementById(id);
              if (!placeholder) {
                return;
              }

              const renderedBase64 = pngResult?.base64 ? pngResult.base64.trim() : '';
              const isLikelyPng = renderedBase64.startsWith('iVBOR');
              if (!pngResult || pngResult.error || !renderedBase64 || !isLikelyPng) {
                const fallbackReason = !pngResult || pngResult.error
                  ? (pngResult?.error || 'Renderer returned empty image data')
                  : (!renderedBase64 ? 'Renderer returned empty image data' : 'Renderer returned invalid image data');
                const errorDetail = escapeHtml(fallbackReason);
                const localizedError = translate('async_html_convert_error', [errorDetail])
                  || `HTML conversion error: ${errorDetail}`;
                const truncated = code.length > 500 ? `${code.slice(0, 500)}...` : code;
                const snippet = escapeHtml(truncated);
                placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">${localizedError}\n\n${snippet}</pre>`;
                return;
              }

              const displayWidth = Math.round(pngResult.width / 4);
              placeholder.outerHTML = `<div class="html-diagram" style="text-align: center; margin: 20px 0;">
                <img src="data:image/png;base64,${renderedBase64}" alt="HTML diagram" width="${displayWidth}px" />
              </div>`;
            } catch (error) {
              const placeholder = document.getElementById(id);
              if (placeholder) {
                const errorDetail = escapeHtml(error.message || '');
                const localizedError = translate('async_html_convert_error', [errorDetail])
                  || `HTML conversion error: ${errorDetail}`;
                const truncated = code.length > 500 ? `${code.slice(0, 500)}...` : code;
                const snippet = escapeHtml(truncated);
                placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">${localizedError}\n\n${snippet}</pre>`;
              }
            }
          }, { code: sanitizedHtml }, 'html', '', 'ready');

          if (result && result.placeholder) {
            parent.children[index] = result.placeholder;
          }
        });
      };
    };
  }

  /**
   * Process HTML to convert SVG images to PNG with intelligent resource handling
   */
  async function processSvgImages(html, renderer) {
    const imgRegex = /<img\s+[^>]*src="([^"]+\.svg)"[^>]*>/gi;
    const matches = [];
    let match;

    // Collect all SVG image tags
    while ((match = imgRegex.exec(html)) !== null) {
      matches.push({
        fullMatch: match[0],
        src: match[1],
        index: match.index
      });
    }

    if (matches.length === 0) {
      return html;
    }

    // Replace SVG images with async placeholders (process in reverse order to preserve indices)
    for (let i = matches.length - 1; i >= 0; i--) {
      const { fullMatch, src } = matches[i];
      const fileName = src.split('/').pop();

      // Determine initial status: data: URLs are ready, everything else needs fetching
      const initialStatus = src.startsWith('data:') ? 'ready' : 'fetching';

      // For data: URLs, parse SVG content immediately
      let initialSvgContent = null;
      if (src.startsWith('data:')) {
        const base64Match = src.match(/^data:image\/svg\+xml;base64,(.+)$/);
        if (base64Match) {
          initialSvgContent = atob(base64Match[1]);
        } else {
          // Try URL encoded format
          const urlMatch = src.match(/^data:image\/svg\+xml[;,](.+)$/);
          if (urlMatch) {
            initialSvgContent = decodeURIComponent(urlMatch[1]);
          } else {
            // Handle unsupported format - this will be caught in the callback
            initialSvgContent = null;
          }
        }
      }

      // Create async task with appropriate status
      const result = asyncTask(async (data) => {
        const { id, src, originalTag, svgContent } = data;
        try {
          if (!svgContent) {
            throw new Error('No SVG content available');
          }

          const pngResult = await renderer.renderSvgToPng(svgContent);
          const placeholder = document.getElementById(id);
          if (placeholder) {
            // Calculate display size (1/4 of original PNG size)
            const displayWidth = Math.round(pngResult.width / 4);
            placeholder.outerHTML = `<span class="svg-diagram" style="text-align: center; margin: 20px 0;">
            <img src="data:image/png;base64,${pngResult.base64}" alt="SVG diagram" width="${displayWidth}px" />
          </span>`;
          }
        } catch (error) {
          const placeholder = document.getElementById(id);
          if (placeholder) {
            placeholder.outerHTML = `<pre style="background: #fee; border-left: 4px solid #f00; padding: 10px; font-size: 12px;">SVG Error: Cannot load file "${escapeHtml(src)}" - ${escapeHtml(error.message)}</pre>`;
          }
        }
      }, { src: src, originalTag: fullMatch, svgContent: initialSvgContent }, 'svg', fileName, initialStatus);

      // For fetching resources, start the fetch process immediately
      if (initialStatus === 'fetching') {
        if (src.startsWith('http://') || src.startsWith('https://')) {
          // Fetch remote resource
          fetch(src)
            .then(response => {
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              return response.text();
            })
            .then(content => {
              result.task.data.svgContent = content;
              result.task.setReady();
            })
            .catch(error => {
              result.task.setError(error);
            });
        } else {
          // Fetch local file
          const baseUrl = window.location.href;
          const absoluteUrl = new URL(src, baseUrl).href;

          chrome.runtime.sendMessage({
            type: 'READ_LOCAL_FILE',
            filePath: absoluteUrl
          })
            .then(response => {
              if (response.error) {
                throw new Error(response.error);
              }
              result.task.data.svgContent = response.content;
              result.task.setReady();
            })
            .catch(error => {
              result.task.setError(error);
            });
        }
      }

      // Replace the image tag with placeholder
      html = html.substring(0, matches[i].index) + result.placeholder.value + html.substring(matches[i].index + fullMatch.length);
    }

    return html;
  }

  /**
   * Process tables to add centering attributes for Word compatibility
   * @param {string} html - HTML content
   * @returns {string} HTML with centered tables
   */
  function processTablesForWordCompatibility(html) {
    // Wrap tables with centering div and add align attributes (same as convert.js)
    html = html.replace(/<table>/g, '<div align="center"><table align="center">');
    html = html.replace(/<\/table>/g, '</table></div>');

    return html;
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize renderer with background cache proxy
  const cacheManager = new BackgroundCacheManagerProxy();
  const renderer = new ExtensionRenderer(cacheManager);

  // Initialize DOCX exporter
  const docxExporter = new DocxExporter(renderer);

  // Store renderer globally for debugging and access from other parts
  window.extensionRenderer = renderer;
  window.docxExporter = docxExporter;

  // Since this script is only injected when content-detector.js confirms this is a markdown file,
  // we can directly proceed with processing
  // Get scroll position from background script (avoids sandbox restrictions)
  async function getSavedScrollPosition() {
    let currentScrollPosition = 0;

    try {
      currentScrollPosition = window.scrollY || window.pageYOffset || 0;
    } catch (e) {
      // Window access blocked, use default position
    }

    // Get saved scroll position from background script
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'getScrollPosition',
        url: document.location.href
      });

      // Return saved position if available and current position is at top (page just loaded)
      if (response && typeof response.position === 'number' && currentScrollPosition === 0) {
        return response.position;
      }
    } catch (e) {
      // Failed to get saved position, use default
    }

    return currentScrollPosition;
  }

  // Get the raw markdown content
  const rawMarkdown = document.body.textContent;

  const toolbarToggleTocTitle = translate('toolbar_toggle_toc_title');
  const toolbarZoomOutTitle = translate('toolbar_zoom_out_title');
  const toolbarZoomInTitle = translate('toolbar_zoom_in_title');
  const toolbarLayoutTitleNormal = translate('toolbar_layout_title_normal');
  const toolbarLayoutTitleWide = translate('toolbar_layout_title_wide');
  const toolbarLayoutTitleFullscreen = translate('toolbar_layout_title_fullscreen');
  const toolbarLayoutTitleNarrow = translate('toolbar_layout_title_narrow');
  const toolbarDownloadTitle = translate('toolbar_download_title');
  const toolbarPrintTitle = translate('toolbar_print_title');

  const toggleTocTitleAttr = escapeHtml(toolbarToggleTocTitle);
  const zoomOutTitleAttr = escapeHtml(toolbarZoomOutTitle);
  const zoomInTitleAttr = escapeHtml(toolbarZoomInTitle);
  const layoutTitleAttr = escapeHtml(toolbarLayoutTitleNormal);
  const downloadTitleAttr = escapeHtml(toolbarDownloadTitle);
  const printTitleAttr = escapeHtml(toolbarPrintTitle);

  // Create a new container for the rendered content
  document.body.innerHTML = `
  <div id="toolbar">
    <div class="toolbar-left">
      <button id="toggle-toc-btn" class="toolbar-btn" title="${toggleTocTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <span id="file-name" class="file-name"></span>
      <div id="processing-indicator" class="processing-indicator hidden">
        <svg class="progress-circle" width="18" height="18" viewBox="0 0 18 18">
          <circle class="progress-circle-bg" cx="9" cy="9" r="7" stroke="#666" stroke-width="2" fill="none"/>
          <circle class="progress-circle-progress" cx="9" cy="9" r="7" stroke="#00d4aa" stroke-width="2" fill="none"
                  stroke-dasharray="43.98" stroke-dashoffset="43.98" transform="rotate(-90 9 9)"/>
        </svg>
      </div>
    </div>
    <div class="toolbar-center">
      <button id="zoom-out-btn" class="toolbar-btn" title="${zoomOutTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 10h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <span id="zoom-level" class="zoom-level">100%</span>
      <button id="zoom-in-btn" class="toolbar-btn" title="${zoomInTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <button id="layout-toggle-btn" class="toolbar-btn" title="${layoutTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
          <rect x="3" y="4" width="14" height="12" stroke-width="2" rx="1"/>
          <line x1="3" y1="7" x2="17" y2="7" stroke-width="2"/>
        </svg>
      </button>
    </div>
    <div class="toolbar-right">
      <button id="download-btn" class="toolbar-btn" title="${downloadTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3v10m0 0l-3-3m3 3l3-3M3 16h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button id="print-btn" class="toolbar-btn" title="${printTitleAttr}">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
          <path d="M5 7V3h10v4M5 14H3V9h14v5h-2M5 14v3h10v-3M5 14h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
  <div id="table-of-contents"></div>
  <div id="toc-overlay" class="hidden"></div>
  <div id="markdown-wrapper">
    <div id="markdown-page">
      <div id="markdown-content"></div>
    </div>
  </div>
`;

  // Wait a bit for DOM to be ready, then start processing
  setTimeout(async () => {
    // Get saved scroll position
    const savedScrollPosition = await getSavedScrollPosition();

    // Initialize toolbar
    initializeToolbar();

    // Parse and render markdown
    await renderMarkdown(rawMarkdown, savedScrollPosition);

    // Setup TOC toggle
    setupTocToggle();

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup responsive behavior
    setupResponsiveToc();

    // Now that all DOM is ready, process async tasks
    // Add a small delay to ensure DOM is fully rendered and visible
    setTimeout(() => {
      processAsyncTasks();
    }, 200);
  }, 100);

  // Listen for scroll events and save position to background script
  let scrollTimeout;
  try {
    window.addEventListener('scroll', () => {
      // Debounce scroll saving to avoid too frequent background messages
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        try {
          const currentPosition = window.scrollY || window.pageYOffset;
          // Save position even when it's 0 (page top) to ensure correct restoration
          chrome.runtime.sendMessage({
            type: 'saveScrollPosition',
            url: document.location.href,
            position: currentPosition
          });
        } catch (e) {
          // Ignore errors
        }
      }, 300); // Save position 300ms after user stops scrolling
    });
  } catch (e) {
    // Scroll event listener setup failed, continuing without scroll persistence
  }

  async function renderMarkdown(markdown, savedScrollPosition = 0) {
    const contentDiv = document.getElementById('markdown-content');

    if (!contentDiv) {
      console.error('markdown-content div not found!');
      return;
    }

    // Pre-process markdown to normalize math blocks and list markers
    let normalizedMarkdown = normalizeMathBlocks(markdown);

    try {
      // Setup markdown processor with async plugins
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkBreaks) // Add line break processing
        .use(remarkMath)
        .use(remarkHtmlToPng(renderer)) // Add HTML processing FIRST
        .use(remarkMermaidToPng(renderer)) // Add Mermaid processing AFTER HTML
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSlug)
        .use(rehypeHighlight) // Add syntax highlighting
        .use(rehypeKatex)
        .use(rehypeStringify, { allowDangerousHtml: true });

      const file = await processor.process(normalizedMarkdown);
      let htmlContent = String(file);

      // Process SVG images (creates placeholders)
      htmlContent = await processSvgImages(htmlContent, renderer);

      // Add table centering for better Word compatibility
      htmlContent = processTablesForWordCompatibility(htmlContent);

      // Sanitize HTML before injecting into the document
      htmlContent = sanitizeRenderedHtml(htmlContent);

      contentDiv.innerHTML = htmlContent;

      // Show the content container
      const pageDiv = document.getElementById('markdown-page');
      if (pageDiv) {
        pageDiv.classList.add('loaded');
      }

      // Generate table of contents after rendering
      generateTOC();

      // Restore scroll position immediately
      restoreScrollPosition(savedScrollPosition);

      // Don't process async tasks here - let main flow handle it
    } catch (error) {
      console.error('Markdown processing error:', error);
      console.error('Error stack:', error.stack);
      contentDiv.innerHTML = `<pre style="color: red; background: #fee; padding: 20px;">Error processing markdown: ${error.message}\n\nStack:\n${error.stack}</pre>`;
      restoreScrollPosition(savedScrollPosition);
    }
  }

  function generateTOC() {
    const contentDiv = document.getElementById('markdown-content');
    const tocDiv = document.getElementById('table-of-contents');

    if (!contentDiv || !tocDiv) return;

    const headings = contentDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      tocDiv.style.display = 'none';
      return;
    }

    // Generate TOC list only
    let tocHTML = '<ul class="toc-list">';

    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName[1]);
      const text = heading.textContent;
      const id = heading.id || `heading-${index}`;

      if (!heading.id) {
        heading.id = id;
      }

      const indent = (level - 1) * 20;
      tocHTML += `<li style="margin-left: ${indent}px"><a href="#${id}">${text}</a></li>`;
    });

    tocHTML += '</ul>';
    tocDiv.innerHTML = tocHTML;
  }

  function setupTocToggle() {
    const tocDiv = document.getElementById('table-of-contents');
    const overlayDiv = document.getElementById('toc-overlay');

    if (!tocDiv || !overlayDiv) return;

    const toggleToc = () => {
      tocDiv.classList.toggle('hidden');
      document.body.classList.toggle('toc-hidden');
      overlayDiv.classList.toggle('hidden');
    };

    // Close TOC when clicking overlay (for mobile)
    overlayDiv.addEventListener('click', toggleToc);

    // Return toggleToc function for use by toolbar button and keyboard shortcuts
    return toggleToc;
  }

  // Setup global keyboard shortcuts
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + B: Toggle TOC
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        const tocDiv = document.getElementById('table-of-contents');
        const overlayDiv = document.getElementById('toc-overlay');
        if (tocDiv && overlayDiv) {
          tocDiv.classList.toggle('hidden');
          document.body.classList.toggle('toc-hidden');
          overlayDiv.classList.toggle('hidden');
        }
        return;
      }

      // Ctrl/Cmd + S: Download as DOCX
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn && !downloadBtn.disabled) {
          downloadBtn.click();
        }
        return;
      }

      // Ctrl/Cmd + P: Print (browser default, but we ensure it's enabled)
      // No need to prevent default for print, browser handles it well
    });
  }

  const PRINT_UPLOAD_CHUNK_SIZE = 256 * 1024;

  async function dispatchPrintJob(html, metadata = {}) {
    const htmlString = typeof html === 'string' ? html : '';
    const totalLength = htmlString.length;

    if (document.location.protocol === 'file:') {
      window.print();
      return 'local-print';
    }

    const sendMessage = (message) => new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });

    const title = typeof metadata.title === 'string' ? metadata.title : undefined;
    const filename = typeof metadata.filename === 'string' ? metadata.filename : undefined;

    let uploadToken = null;

    try {
      const uploadResult = await uploadInChunks({
        sendMessage,
        purpose: 'print-html',
        encoding: 'text',
        totalSize: totalLength,
        metadata: {
          title: title || 'Document',
          filename: filename || 'document.html'
        },
        requestedChunkSize: PRINT_UPLOAD_CHUNK_SIZE,
        getChunk: (offset, size) => htmlString.slice(offset, offset + size)
      });

      uploadToken = uploadResult.token;

      const startResponse = await sendMessage({
        type: 'PRINT_JOB_START',
        token: uploadToken,
        payload: {
          title: title || 'Document',
          filename: filename || 'document.html'
        }
      });

      if (!startResponse || !startResponse.success) {
        const errorDetail = startResponse?.error ? `: ${startResponse.error}` : '';
        throw new Error(`Failed to start print job${errorDetail}`);
      }

      return uploadToken;
    } catch (error) {
      if (uploadToken) {
        abortUpload(sendMessage, uploadToken);
      }
      throw error;
    }
  }

  function initializeToolbar() {
    // Set file name from URL
    const fileNameSpan = document.getElementById('file-name');
    if (fileNameSpan) {
      const fileName = getFilenameFromURL();
      fileNameSpan.textContent = fileName;
    }

    // Setup toolbar button handlers
    setupToolbarButtons();
  }

  function setupToolbarButtons() {
    // Toggle TOC button
    const toggleTocBtn = document.getElementById('toggle-toc-btn');
    const tocDiv = document.getElementById('table-of-contents');
    const overlayDiv = document.getElementById('toc-overlay');

    if (toggleTocBtn && tocDiv && overlayDiv) {
      toggleTocBtn.addEventListener('click', () => {
        tocDiv.classList.toggle('hidden');
        document.body.classList.toggle('toc-hidden');
        overlayDiv.classList.toggle('hidden');
      });
    }

    // Zoom controls
    let zoomLevel = 100;
    const zoomLevelSpan = document.getElementById('zoom-level');
    const contentDiv = document.getElementById('markdown-content');

    const updateZoom = (newLevel) => {
      zoomLevel = Math.max(50, Math.min(400, newLevel));
      if (zoomLevelSpan) {
        zoomLevelSpan.textContent = zoomLevel + '%';
      }
      if (contentDiv) {
        // Apply zoom using CSS zoom property (like browser zoom)
        contentDiv.style.zoom = (zoomLevel / 100);
      }
    };

    // Click zoom level to reset to 100%
    if (zoomLevelSpan) {
      zoomLevelSpan.style.cursor = 'pointer';
      zoomLevelSpan.addEventListener('click', () => {
        updateZoom(100);
      });
    }

    const zoomInBtn = document.getElementById('zoom-in-btn');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        updateZoom(zoomLevel + 10);
      });
    }

    const zoomOutBtn = document.getElementById('zoom-out-btn');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        updateZoom(zoomLevel - 10);
      });
    }

    // Layout toggle button
    const layoutBtn = document.getElementById('layout-toggle-btn');
    const pageDiv = document.getElementById('markdown-page');
    let currentLayout = 'normal'; // normal, wide, fullscreen, narrow
    const WIDE_LAYOUT_THRESHOLD = 2420;

    // SVG icons for different layouts
    const layoutIcons = {
      normal: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <rect x="3" y="4" width="14" height="12" stroke-width="2" rx="1"/>
      <line x1="3" y1="7" x2="17" y2="7" stroke-width="2"/>
    </svg>`,
      wide: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <rect x="2" y="4" width="16" height="12" stroke-width="2" rx="1"/>
      <line x1="2" y1="7" x2="18" y2="7" stroke-width="2"/>
      <line x1="6" y1="4" x2="6" y2="16" stroke-width="1.5"/>
      <line x1="14" y1="4" x2="14" y2="16" stroke-width="1.5"/>
    </svg>`,
      fullscreen: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <rect x="2" y="2" width="16" height="16" stroke-width="2" rx="1"/>
      <line x1="2" y1="6" x2="18" y2="6" stroke-width="2"/>
    </svg>`,
      narrow: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor">
      <rect x="6" y="3" width="8" height="14" stroke-width="2" rx="1"/>
      <line x1="6" y1="6" x2="14" y2="6" stroke-width="2"/>
    </svg>`
    };

    const layoutTitles = {
      normal: toolbarLayoutTitleNormal,
      wide: toolbarLayoutTitleWide || toolbarLayoutTitleNormal,
      fullscreen: toolbarLayoutTitleFullscreen,
      narrow: toolbarLayoutTitleNarrow
    };

    if (layoutBtn && pageDiv) {
      const layoutConfigs = {
        normal: { maxWidth: '1060px', icon: layoutIcons.normal, title: layoutTitles.normal },
        wide: { maxWidth: '2120px', icon: layoutIcons.wide, title: layoutTitles.wide },
        fullscreen: { maxWidth: '100%', icon: layoutIcons.fullscreen, title: layoutTitles.fullscreen },
        narrow: { maxWidth: '530px', icon: layoutIcons.narrow, title: layoutTitles.narrow }
      };

      const isWideLayoutAvailable = () => window.innerWidth > WIDE_LAYOUT_THRESHOLD;
      const getLayoutSequence = () => (isWideLayoutAvailable()
        ? ['normal', 'wide', 'fullscreen', 'narrow']
        : ['normal', 'fullscreen', 'narrow']);

      const applyLayout = (layout) => {
        const config = layoutConfigs[layout];
        if (!config) {
          return;
        }
        currentLayout = layout;
        pageDiv.style.maxWidth = config.maxWidth;
        layoutBtn.innerHTML = config.icon;
        layoutBtn.title = config.title;
        if (isWideLayoutAvailable() && (layout === 'wide' || layout === 'fullscreen')) {
          updateZoom(200);
        } else if (layout === 'normal' || layout === 'narrow') {
          updateZoom(100);
        }
      };

      applyLayout('normal');

      layoutBtn.addEventListener('click', () => {
        const sequence = getLayoutSequence();
        if (!sequence.includes(currentLayout)) {
          applyLayout(sequence[0]);
          return;
        }

        const currentIndex = sequence.indexOf(currentLayout);
        const nextLayout = sequence[(currentIndex + 1) % sequence.length];
        applyLayout(nextLayout);
      });

      window.addEventListener('resize', () => {
        if (currentLayout === 'wide' && !isWideLayoutAvailable()) {
          applyLayout('fullscreen');
        }
      });
    }

    // Download button (DOCX export)
    // Download button
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        // Prevent multiple clicks
        if (downloadBtn.disabled) {
          return;
        }

        try {
          // Disable button and show progress indicator
          downloadBtn.disabled = true;
          downloadBtn.classList.add('downloading');

          // Add progress indicator to button
          const originalContent = downloadBtn.innerHTML;
          const progressHTML = `
          <svg class="progress-circle" width="18" height="18" viewBox="0 0 18 18">
            <circle class="progress-circle-bg" cx="9" cy="9" r="7" stroke="currentColor" stroke-width="2" fill="none" opacity="0.3"/>
            <circle class="download-progress-circle" cx="9" cy="9" r="7" stroke="currentColor" stroke-width="2" fill="none"
                    stroke-dasharray="43.98" stroke-dashoffset="43.98" transform="rotate(-90 9 9)"/>
          </svg>
        `;
          downloadBtn.innerHTML = progressHTML;

          // Get the original markdown content
          const markdown = rawMarkdown;

          // Generate filename from document title or URL
          const filename = getDocumentFilename();

          // Export to DOCX with progress callback
          const exportErrorFallback = translate('docx_export_failed_default');
          const result = await docxExporter.exportToDocx(markdown, filename, (completed, total) => {
            // Update progress circle
            const progressCircle = downloadBtn.querySelector('.download-progress-circle');
            if (progressCircle && total > 0) {
              const progress = completed / total;
              const circumference = 43.98; // 2 * PI * 7
              const offset = circumference * (1 - progress);
              progressCircle.style.strokeDashoffset = offset;
            }
          });

          if (!result.success) {
            throw new Error(result.error || exportErrorFallback);
          }

          // Restore button after successful download
          downloadBtn.innerHTML = originalContent;
          downloadBtn.disabled = false;
          downloadBtn.classList.remove('downloading');
        } catch (error) {
          console.error('Export error:', error);
          const alertDetail = error?.message ? `: ${error.message}` : '';
          const alertMessage = translate('docx_export_failed_alert', [alertDetail])
            || `Export failed${alertDetail}`;
          alert(alertMessage);

          // Restore button on error
          const originalContent = `
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 3v10m0 0l-3-3m3 3l3-3M3 16h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
          downloadBtn.innerHTML = originalContent;
          downloadBtn.disabled = false;
          downloadBtn.classList.remove('downloading');
        }
      });
    }

    // Print button
    const printBtn = document.getElementById('print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', async () => {
        const contentDiv = document.getElementById('markdown-content');
        if (!contentDiv) {
          return;
        }

        const htmlContent = contentDiv.innerHTML;
        const printTitle = document.title || getDocumentFilename();
        const fileName = getDocumentFilename();

        try {
          if (printBtn.disabled) {
            return;
          }
          printBtn.disabled = true;

          await dispatchPrintJob(htmlContent, {
            title: printTitle,
            filename: fileName
          });
        } catch (error) {
          console.error('Print request failed:', error);
          alert(`Failed to open print preview: ${error.message}`);
        } finally {
          printBtn.disabled = false;
        }
      });
    }
  }

  // Get filename from URL with proper decoding and hash removal
  function getFilenameFromURL() {
    const url = window.location.href;
    const urlParts = url.split('/');
    let fileName = urlParts[urlParts.length - 1] || 'document.md';

    // Remove hash part (# and everything after)
    fileName = fileName.split('#')[0];

    // Decode URL encoding
    try {
      fileName = decodeURIComponent(fileName);
    } catch (e) {
    }

    return fileName;
  }

  function getDocumentFilename() {
    // Get base filename
    const fileName = getFilenameFromURL();

    // Remove .md or .markdown extension and add .docx
    const nameWithoutExt = fileName.replace(/\.(md|markdown)$/i, '');
    if (nameWithoutExt) {
      return nameWithoutExt + '.docx';
    }

    // Try to get from first h1 heading
    const firstH1 = document.querySelector('#markdown-content h1');
    if (firstH1) {
      const title = firstH1.textContent.trim()
        .replace(/[^\w\s\u4e00-\u9fa5-]/g, '') // Keep alphanumeric, spaces, Chinese chars, and dashes
        .replace(/\s+/g, '-') // Replace spaces with dashes
        .substring(0, 50); // Limit length

      if (title) {
        return title + '.docx';
      }
    }

    // Default fallback
    return 'document.docx';
  }

  function setupResponsiveToc() {
    const tocDiv = document.getElementById('table-of-contents');

    if (!tocDiv) return;

    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        // On smaller screens, hide TOC by default
        tocDiv.classList.add('hidden');
        document.body.classList.add('toc-hidden');
      } else {
        // On larger screens, show TOC by default
        tocDiv.classList.remove('hidden');
        document.body.classList.remove('toc-hidden');
      }
    };

    // Set initial state
    handleResize();

    // Listen for window resize
    window.addEventListener('resize', handleResize);
  }

}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== 'localeChanged') {
    return;
  }

  const locale = message.locale || DEFAULT_SETTING_LOCALE;

  Localization.setPreferredLocale(locale)
    .catch((error) => {
      console.error('Failed to update locale in content script:', error);
    })
    .finally(() => {
      // Reload to re-render UI with new locale
      window.location.reload();
    });
});

Localization.init().catch((error) => {
  console.error('Localization init failed in content script:', error);
}).finally(() => {
  initializeContentScript();
});

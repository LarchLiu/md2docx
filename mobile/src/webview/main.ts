// Mobile WebView Entry Point
// This is the main entry point for the mobile WebView
// Note: Diagram renderers (mermaid, vega, etc.) run in a separate iframe

import { platform, bridge } from './api-impl';
import Localization from '../../../src/utils/localization';
import themeManager from '../../../src/utils/theme-manager';
import DocxExporter from '../../../src/exporters/docx-exporter';
import { loadAndApplyTheme } from '../../../src/utils/theme-to-css';
import { AsyncTaskManager } from '../../../src/core/markdown-processor';
import { renderMarkdownDocument, getDocument, type FrontmatterDisplay } from '../../../src/core/viewer/viewer-controller';
import { createScrollSyncController, type ScrollSyncController } from '../../../src/core/line-based-scroll';
import type { PluginRenderer } from '../../../src/types/index';
import type { PlatformBridgeAPI } from '../../../src/types/index';

declare global {
  var bridge: PlatformBridgeAPI | undefined;
}

// Make platform globally available (same as Chrome)
globalThis.platform = platform;
// Expose bridge for shared plugins that need host file/asset access
globalThis.bridge = bridge;

// Global state
let currentMarkdown = '';
let currentFilename = '';
let currentThemeId = 'default'; // Current theme ID (loaded via shared loadAndApplyTheme)
let currentTaskManager: AsyncTaskManager | null = null; // Track current task manager for cancellation
let currentZoomLevel = 1; // Store current zoom level for applying after content render
let scrollSyncController: ScrollSyncController | null = null; // Scroll sync controller

function createPluginRenderer(): PluginRenderer {
  return {
    render: async (type: string, content: string | object) => {
      const result = await platform.renderer.render(type, content);

      return {
        base64: result.base64,
        width: result.width,
        height: result.height,
        format: result.format,
        error: undefined
      };
    }
  };
}

/**
 * Load markdown payload
 */
interface LoadMarkdownPayload {
  content: string;
  filename?: string;
  themeId?: string;     // Theme ID (WebView loads theme data itself)
  scrollLine?: number;  // Saved scroll position (line number)
}

/**
 * Set theme payload
 */
interface SetThemePayload {
  themeId: string;
}

/**
 * Update settings payload
 */
interface UpdateSettingsPayload {
  settings: Record<string, unknown>;
}

/**
 * Set locale payload
 */
interface SetLocalePayload {
  locale: string;
}

/**
 * Bridge message type
 */
interface BridgeMessage {
  type?: string;
  payload?: LoadMarkdownPayload | SetThemePayload | UpdateSettingsPayload | SetLocalePayload;
}

function isBridgeMessage(message: unknown): message is BridgeMessage {
  if (!message || typeof message !== 'object') return false;
  const obj = message as Record<string, unknown>;
  return typeof obj.type === 'string';
}

/**
 * Initialize the mobile viewer
 */
async function initialize(): Promise<void> {
  try {
    // Initialize localization (will use fallback if fetch fails)
    await Localization.init();

    // Initialize theme manager (loads font-config.json and registry.json)
    // This must complete before we can load themes
    await themeManager.initialize();

    // Pre-initialize render iframe (don't wait, let it load in background)
    platform.renderer.ensureReady().catch((err: Error) => {
      console.warn('[Mobile] Render frame pre-init failed:', err?.message, err?.stack);
    });

    // Initialize scroll sync controller FIRST (before message handlers)
    // Uses #markdown-content as container, window scroll for mobile
    initScrollSyncController();

    // Set up link click handling via event delegation
    setupLinkHandling();

    // Set up message handlers from host app (Flutter)
    setupMessageHandlers();

    // Notify host app that WebView is ready
    platform.notifyReady();
  } catch (error) {
    console.error('[Mobile] Initialization failed:', error);
  }
}

/**
 * Initialize scroll sync controller (singleton, created once at startup)
 */
function initScrollSyncController(): void {
  const container = document.getElementById('markdown-content');
  if (!container) {
    console.warn('[Mobile] markdown-content container not found!');
    return;
  }

  scrollSyncController = createScrollSyncController({
    container,
    getLineMapper: getDocument,
    userScrollDebounceMs: 10,  // Reduced for faster reverse sync feedback
    onUserScroll: (line) => {
      // Report scroll position to host app for saving
      bridge.postMessage('SCROLL_LINE_CHANGED', { line });
    },
  });

  scrollSyncController.start();
}

/**
 * Set up handlers for messages from host app
 */
function setupMessageHandlers(): void {
  bridge.addListener(async (message: unknown) => {
    if (!isBridgeMessage(message) || !message.type) return;

    try {
      switch (message.type) {
        case 'LOAD_MARKDOWN':
          await handleLoadMarkdown(message.payload as LoadMarkdownPayload);
          break;

        case 'SET_THEME':
          await handleSetTheme(message.payload as SetThemePayload);
          break;

        case 'EXPORT_DOCX':
          await handleExportDocx();
          break;

        case 'UPDATE_SETTINGS':
          await handleUpdateSettings(message.payload as UpdateSettingsPayload);
          break;

        case 'SET_LOCALE':
          await handleSetLocale(message.payload as SetLocalePayload);
          break;

        default:
          // Ignore unknown message types (RENDER_FRAME_LOG, RESPONSE, etc.)
          break;
      }
    } catch (error) {
      console.error('[Mobile] Message handler error:', error);
    }
  });
}

/**
 * Handle loading Markdown content
 */
async function handleLoadMarkdown(payload: LoadMarkdownPayload): Promise<void> {
  const { content, filename, themeId, scrollLine } = payload;

  // Check if file changed
  const newFilename = filename || 'document.md';
  const fileChanged = currentFilename !== newFilename;

  // Only abort on file switch - incremental updates let old tasks complete naturally
  // (old tasks will find their placeholder gone and silently discard results)
  if (fileChanged && currentTaskManager) {
    currentTaskManager.abort();
    currentTaskManager = null;
  }

  currentMarkdown = content;
  currentFilename = newFilename;

  try {
    // Update theme if provided (Flutter sends themeId, we load it ourselves)
    if (themeId && themeId !== currentThemeId) {
      currentThemeId = themeId;
    }

    // Create task manager
    const taskManager = new AsyncTaskManager(
      (key: string, subs?: string | string[]) => Localization.translate(key, subs)
    );
    currentTaskManager = taskManager;

    const pluginRenderer = createPluginRenderer();
    const container = document.getElementById('markdown-content');

    let titleForHost = currentFilename;

    if (container) {
      // Clear container FIRST, then apply theme (avoids flicker from old content with new style)
      container.innerHTML = '';

      // Reset scroll controller AFTER clearing container
      // This prevents scroll events from updating targetLine with stale DOM data
      if (scrollSyncController) {
        scrollSyncController.reset();
        scrollSyncController.setTargetLine(scrollLine ?? 0);
      }

      // Load and apply theme using shared function (all theme logic is handled internally)
      await loadAndApplyTheme(currentThemeId);

      // Apply saved zoom level before rendering to avoid flicker
      if (currentZoomLevel !== 1) {
        (container as HTMLElement).style.zoom = String(currentZoomLevel);
      }

      // Get frontmatter display setting
      let frontmatterDisplay: FrontmatterDisplay = 'hide';
      try {
        const result = await platform.storage.get(['markdownViewerSettings']);
        const settings = (result.markdownViewerSettings || {}) as Record<string, unknown>;
        frontmatterDisplay = (settings.frontmatterDisplay as FrontmatterDisplay) || 'hide';
      } catch {
        // Use default on error
      }

      const renderResult = await renderMarkdownDocument({
        markdown: content,
        container: container as HTMLElement,
        renderer: pluginRenderer,
        translate: (key: string, subs?: string | string[]) => Localization.translate(key, subs),
        taskManager,
        clearContainer: false,
        frontmatterDisplay,
        onHeadings: (headings) => {
          bridge.postMessage('HEADINGS_UPDATED', headings);
        },
        onStreamingComplete: () => {
          // Streaming is complete, notify scroll controller
          scrollSyncController?.onStreamingComplete();
        },
      });

      if (taskManager.isAborted()) {
        return;
      }

      titleForHost = renderResult.title || currentFilename;

      // Process async tasks after initial render (same pattern as Chrome)
      await renderResult.taskManager.processAll((completed, total) => {
        if (!taskManager.isAborted()) {
          bridge.postMessage('RENDER_PROGRESS', { completed, total });
        }
      });
    }

    // Clear task manager reference after successful completion
    if (currentTaskManager === taskManager) {
      currentTaskManager = null;
    }

    // Notify host app that rendering is complete
    bridge.postMessage('RENDER_COMPLETE', {
      filename: currentFilename,
      title: titleForHost
    });

  } catch (error) {
    const err = error as Error;
    console.error('[Mobile] Markdown processing failed:', err.message, err.stack);
    bridge.postMessage('RENDER_ERROR', {
      error: err.message
    });
  }
}

/**
 * Set up link click handling via event delegation
 */
function setupLinkHandling(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    e.preventDefault();

    // External links (http/https) - open in system browser
    if (href.startsWith('http://') || href.startsWith('https://')) {
      bridge.postMessage('OPEN_URL', { url: href });
    }
    // Relative links
    else {
      // Check if it's a markdown file
      const isMarkdown = href.endsWith('.md') || href.endsWith('.markdown');

      if (isMarkdown) {
        // Load markdown file internally
        bridge.postMessage('LOAD_RELATIVE_MARKDOWN', { path: href });
      } else {
        // For other relative files (images, etc.), try to open with system handler
        bridge.postMessage('OPEN_RELATIVE_FILE', { path: href });
      }
    }
  });
}

/**
 * Handle theme change - called when Flutter sends theme ID
 * WebView loads theme data itself using shared loadAndApplyTheme
 */
async function handleSetTheme(payload: SetThemePayload): Promise<void> {
  const { themeId } = payload;
  
  // Skip if same theme
  if (themeId === currentThemeId) {
    return;
  }
  
  const previousThemeId = currentThemeId;
  currentThemeId = themeId;
  
  // Notify Flutter of theme change
  bridge.postMessage('THEME_CHANGED', { themeId });
  
  // Re-render if we have content and theme actually changed
  if (currentMarkdown && previousThemeId !== themeId) {
    // Get current line from scrollSyncController before re-render
    const scrollLine = scrollSyncController?.getCurrentLine() ?? 0;
    
    await handleLoadMarkdown({ content: currentMarkdown, filename: currentFilename || '', scrollLine });
  }
}

/**
 * Handle DOCX export
 */
async function handleExportDocx(): Promise<void> {
  try {
    // Convert filename from .md to .docx
    let docxFilename = currentFilename || 'document.docx';
    if (docxFilename.toLowerCase().endsWith('.md')) {
      docxFilename = docxFilename.slice(0, -3) + '.docx';
    } else if (docxFilename.toLowerCase().endsWith('.markdown')) {
      docxFilename = docxFilename.slice(0, -9) + '.docx';
    } else if (!docxFilename.toLowerCase().endsWith('.docx')) {
      docxFilename = docxFilename + '.docx';
    }

    const exporter = new DocxExporter(createPluginRenderer());
    
    // Report progress to Flutter
    const onProgress = (completed: number, total: number) => {
      bridge.postMessage('EXPORT_PROGRESS', { 
        completed, 
        total,
        phase: 'processing' // processing, packaging, sharing
      });
    };
    
    const result = await exporter.exportToDocx(currentMarkdown, docxFilename, onProgress);

    if (!result.success) {
      throw new Error(result.error || 'Export failed');
    }

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : '';
    console.error('[Mobile] DOCX export failed:', errMsg, errStack);
    bridge.postMessage('EXPORT_ERROR', { error: errMsg });
  }
}

/**
 * Handle settings update
 */
async function handleUpdateSettings(payload: UpdateSettingsPayload): Promise<void> {
  // Reserved for future settings; keep handler to avoid breaking host messages.
}

/**
 * Handle locale change
 */
async function handleSetLocale(payload: SetLocalePayload): Promise<void> {
  try {
    await Localization.setPreferredLocale(payload.locale);
    bridge.postMessage('LOCALE_CHANGED', { locale: payload.locale });
    
    // Re-render content with new locale (for translated error messages, etc.)
    if (currentMarkdown) {
      await handleLoadMarkdown({ content: currentMarkdown, filename: currentFilename || '' });
    }
  } catch (error) {
    console.error('[Mobile] Locale change failed:', error);
  }
}

// Extend Window interface for mobile API
// Most functionality is now on platform object, only expose minimal API for Flutter calls
declare global {
  interface Window {
    // Content loading (Flutter sends themeId, WebView loads theme itself)
    loadMarkdown: (content: string, filename?: string, themeId?: string, scrollLine?: number) => void;
    // Theme change (Flutter sends themeId only)
    setTheme: (themeId: string) => void;
    // Export
    exportDocx: () => void;
    // Display settings
    setFontSize: (size: number) => void;
    setLocale: (locale: string) => void;
    // Re-render with updated settings
    rerender: () => Promise<void>;
    // Platform object has all services: platform.cache, platform.i18n, etc.
  }
}

// Expose API to window for host app to call (e.g. via runJavaScript)
window.loadMarkdown = (content: string, filename?: string, themeId?: string, scrollLine?: number) => {
  handleLoadMarkdown({ content, filename, themeId, scrollLine });
};

// Set theme (WebView loads theme data itself using shared loadAndApplyTheme)
window.setTheme = (themeId: string) => {
  handleSetTheme({ themeId });
};

window.exportDocx = () => {
  handleExportDocx();
};

window.setFontSize = (size: number) => {
  try {
    const oldZoom = currentZoomLevel;
    // Use zoom like Chrome extension (size is treated as percentage base)
    // 16pt = 100%, 12pt = 75%, 24pt = 150%
    currentZoomLevel = size / 16;
    
    // Skip if no actual change
    if (oldZoom === currentZoomLevel) return;
    
    // Lock scroll position before font size change
    scrollSyncController?.lock();
    
    const container = document.getElementById('markdown-content');
    if (container) {
      (container as HTMLElement).style.zoom = String(currentZoomLevel);
    }
  } catch (error) {
    console.error('[Mobile] Failed to set font size:', error);
  }
};

window.setLocale = (locale: string) => {
  handleSetLocale({ locale });
};

window.rerender = async () => {
  // Re-render current markdown with updated settings
  if (currentMarkdown) {
    await handleLoadMarkdown({ content: currentMarkdown, filename: currentFilename });
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

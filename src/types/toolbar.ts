/**
 * Toolbar Type Definitions
 * Types for UI toolbar
 */

import type { TranslateFunction, EscapeHtmlFunction, FileState } from './core';
import type { DocxExporter } from './docx';

// =============================================================================
// Layout Types
// =============================================================================

/**
 * Layout configuration
 */
export interface LayoutConfig {
  maxWidth: string;
  icon: string;
  title: string;
}

// =============================================================================
// Toolbar Types
// =============================================================================

/**
 * Toolbar manager options
 */
export interface ToolbarManagerOptions {
  translate: TranslateFunction;
  escapeHtml: EscapeHtmlFunction;
  saveFileState: (state: FileState) => void;
  getFileState: () => Promise<FileState>;
  rawMarkdown: string;
  docxExporter: DocxExporter;
  cancelScrollRestore: () => void;
  updateActiveTocItem: () => void;
  toolbarPrintDisabledTitle: string;
  /** Called before zoom changes to lock scroll position */
  onBeforeZoom?: () => void;
}

/**
 * Generate toolbar HTML options
 */
export interface GenerateToolbarHTMLOptions {
  translate: TranslateFunction;
  escapeHtml: EscapeHtmlFunction;
  initialTocClass: string;
  initialMaxWidth: string;
  initialZoom: number;
}

/**
 * Toolbar manager instance interface
 */
export interface ToolbarManagerInstance {
  layoutIcons: Record<string, string>;
  layoutConfigs: Record<string, LayoutConfig>;
  applyZoom: (newLevel: number, saveState?: boolean) => void;
  getZoomLevel: () => number;
  setInitialZoom: (level: number) => void;
  initializeToolbar: () => void;
  setupToolbarButtons: () => Promise<void>;
  setupKeyboardShortcuts: () => void;
}

/**
 * Markdown Document - In-memory document structure for incremental updates
 * 
 * This module provides a pure data structure for managing markdown documents
 * without any DOM dependencies. It handles:
 * - Block-level parsing and tracking with stable IDs
 * - Content hashing for change detection
 * - Incremental diff computation
 * - Virtual DOM with precise DOM operation commands
 * - Line number mapping for scroll sync
 */

import {
  splitMarkdownIntoBlocksWithLines,
  type BlockWithLine,
} from './markdown-block-splitter';
import { hashCode } from '../utils/hash';

/**
 * Block metadata stored in memory
 */
export interface BlockMeta {
  /** Unique block ID (stable across updates for same content position) */
  id: string;
  /** Block hash (content-based) */
  hash: string;
  /** Source line number (0-based) */
  startLine: number;
  /** Number of source lines */
  lineCount: number;
  /** Raw markdown content */
  content: string;
  /** Rendered HTML (if available) */
  html?: string;
  /** Whether this block contains async placeholder */
  hasPlaceholder?: boolean;
}

/**
 * Block attributes for DOM elements
 */
export interface BlockAttrs {
  'data-block-id': string;
  'data-block-hash': string;
  'data-line': number;
  'data-line-count': number;
}

/**
 * DOM operation command - platform-agnostic instructions for updating the DOM
 */
export type DOMCommand =
  | { type: 'clear' }
  | { type: 'append'; blockId: string; html: string; attrs: BlockAttrs }
  | { type: 'insertBefore'; blockId: string; html: string; refId: string; attrs: BlockAttrs }
  | { type: 'remove'; blockId: string }
  | { type: 'replace'; blockId: string; html: string; attrs: BlockAttrs }
  | { type: 'updateAttrs'; blockId: string; attrs: Partial<BlockAttrs> };

/**
 * Result of computing DOM commands
 */
export interface DOMCommandResult {
  commands: DOMCommand[];
  stats: {
    kept: number;
    inserted: number;
    removed: number;
    replaced: number;
  };
}

/**
 * Diff operation type (internal)
 */
type DiffOp = 
  | { type: 'keep'; newIndex: number; oldIndex: number }
  | { type: 'insert'; newIndex: number }
  | { type: 'delete'; oldIndex: number };

/**
 * Normalize math blocks in markdown text
 * Converts single-line $$...$$ to multi-line format for proper display math rendering
 */
export function normalizeMathBlocks(markdown: string): string {
  const singleLineMathRegex = /^(\s*)(?<!\$\$)\$\$(.+?)\$\$(?!\$\$)\s*$/gm;
  return markdown.replace(singleLineMathRegex, (_match, _indent, formula) => {
    return `\n$$\n${formula.trim()}\n$$\n`;
  });
}

/**
 * In-memory markdown document with virtual DOM support
 */
export class MarkdownDocument {
  private blocks: BlockMeta[] = [];
  private rawContent: string = '';
  private normalizedContent: string = '';
  private idCounter: number = 0;
  
  /**
   * Create a new document (optionally with initial content)
   */
  constructor(markdown?: string) {
    if (markdown) {
      this.update(markdown);
    }
  }

  /**
   * Get all blocks
   */
  getBlocks(): readonly BlockMeta[] {
    return this.blocks;
  }

  /**
   * Get block by index
   */
  getBlock(index: number): BlockMeta | undefined {
    return this.blocks[index];
  }

  /**
   * Get block by ID
   */
  getBlockById(id: string): BlockMeta | undefined {
    return this.blocks.find(b => b.id === id);
  }

  /**
   * Get block count
   */
  get blockCount(): number {
    return this.blocks.length;
  }

  /**
   * Get raw markdown content
   */
  getRawContent(): string {
    return this.rawContent;
  }

  /**
   * Get normalized content (math blocks expanded)
   */
  getNormalizedContent(): string {
    return this.normalizedContent;
  }

  /**
   * Find block by line number
   */
  findBlockByLine(line: number): { block: BlockMeta; index: number } | null {
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      if (line >= block.startLine && line < block.startLine + block.lineCount) {
        return { block, index: i };
      }
    }
    return null;
  }

  /**
   * Update document content and return DOM commands for incremental update
   */
  update(markdown: string): DOMCommandResult {
    const oldBlocks = this.blocks;
    const isFirstRender = oldBlocks.length === 0;
    
    // Normalize and parse
    this.rawContent = markdown;
    this.normalizedContent = normalizeMathBlocks(markdown);
    const parsedBlocks = splitMarkdownIntoBlocksWithLines(this.normalizedContent);
    
    // Build new block metadata
    const newBlocks: BlockMeta[] = parsedBlocks.map((block, index) => {
      const nextBlock = parsedBlocks[index + 1];
      const lineCount = nextBlock 
        ? nextBlock.startLine - block.startLine 
        : block.content.split('\n').length;
      const blockHash = hashCode(block.content);
      
      return {
        id: '', // Will be assigned after diffing
        hash: blockHash,
        startLine: block.startLine,
        lineCount,
        content: block.content,
        html: undefined,
      };
    });

    // First render: simple append all
    if (isFirstRender) {
      for (let i = 0; i < newBlocks.length; i++) {
        newBlocks[i].id = this.generateNewId();
      }
      this.blocks = newBlocks;
      
      return {
        commands: [{ type: 'clear' }],
        stats: { kept: 0, inserted: newBlocks.length, removed: 0, replaced: 0 },
      };
    }

    // Compute diff operations
    const diffOps = this.computeDiff(oldBlocks, newBlocks);
    
    // Generate DOM commands and assign IDs
    const result = this.generateDOMCommands(oldBlocks, newBlocks, diffOps);
    
    this.blocks = newBlocks;
    return result;
  }

  /**
   * Generate a new unique block ID
   */
  private generateNewId(): string {
    return `block-${++this.idCounter}`;
  }

  /**
   * Compute diff between old and new block arrays using LCS-based algorithm
   */
  private computeDiff(oldBlocks: BlockMeta[], newBlocks: BlockMeta[]): DiffOp[] {
    // Build hash-to-indices map for old blocks
    const oldHashMap = new Map<string, number[]>();
    oldBlocks.forEach((block, index) => {
      const list = oldHashMap.get(block.hash) || [];
      list.push(index);
      oldHashMap.set(block.hash, list);
    });

    // Track which old blocks are matched
    const usedOldIndices = new Set<number>();
    const matches: { newIndex: number; oldIndex: number }[] = [];

    // Find matching blocks (same hash), prefer position proximity
    for (let newIndex = 0; newIndex < newBlocks.length; newIndex++) {
      const hash = newBlocks[newIndex].hash;
      const candidates = oldHashMap.get(hash);
      
      if (candidates) {
        let bestOldIndex = -1;
        let bestDistance = Infinity;
        
        for (const oldIndex of candidates) {
          if (!usedOldIndices.has(oldIndex)) {
            const distance = Math.abs(oldIndex - newIndex);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestOldIndex = oldIndex;
            }
          }
        }
        
        if (bestOldIndex >= 0) {
          matches.push({ newIndex, oldIndex: bestOldIndex });
          usedOldIndices.add(bestOldIndex);
        }
      }
    }

    // Sort matches by new index for sequential processing
    matches.sort((a, b) => a.newIndex - b.newIndex);

    // Generate diff ops
    const ops: DiffOp[] = [];
    const matchedNewIndices = new Set(matches.map(m => m.newIndex));
    let matchIdx = 0;

    for (let newIndex = 0; newIndex < newBlocks.length; newIndex++) {
      if (matchedNewIndices.has(newIndex)) {
        const match = matches[matchIdx++];
        ops.push({ type: 'keep', newIndex, oldIndex: match.oldIndex });
      } else {
        ops.push({ type: 'insert', newIndex });
      }
    }

    // Add deletions
    for (let oldIndex = 0; oldIndex < oldBlocks.length; oldIndex++) {
      if (!usedOldIndices.has(oldIndex)) {
        ops.push({ type: 'delete', oldIndex });
      }
    }

    return ops;
  }

  /**
   * Generate DOM commands from diff operations
   */
  private generateDOMCommands(
    oldBlocks: BlockMeta[],
    newBlocks: BlockMeta[],
    diffOps: DiffOp[]
  ): DOMCommandResult {
    const commands: DOMCommand[] = [];
    const stats = { kept: 0, inserted: 0, removed: 0, replaced: 0 };

    // Build old ID map
    const oldIdMap = new Map<number, string>();
    oldBlocks.forEach((block, index) => {
      oldIdMap.set(index, block.id);
    });

    // Separate ops by type
    const keepOps = diffOps.filter(op => op.type === 'keep') as { type: 'keep'; newIndex: number; oldIndex: number }[];
    const insertOps = diffOps.filter(op => op.type === 'insert') as { type: 'insert'; newIndex: number }[];
    const deleteOps = diffOps.filter(op => op.type === 'delete') as { type: 'delete'; oldIndex: number }[];

    // Assign IDs to new blocks
    // - Keep blocks: inherit ID from old block
    // - Insert blocks: generate new ID
    for (const op of keepOps) {
      const oldBlock = oldBlocks[op.oldIndex];
      newBlocks[op.newIndex].id = oldBlock.id;
      // Preserve cached HTML
      if (oldBlock.html) {
        newBlocks[op.newIndex].html = oldBlock.html;
      }
      stats.kept++;
    }

    for (const op of insertOps) {
      newBlocks[op.newIndex].id = this.generateNewId();
      stats.inserted++;
    }

    // Generate remove commands (do removes first)
    for (const op of deleteOps) {
      const oldId = oldIdMap.get(op.oldIndex)!;
      commands.push({ type: 'remove', blockId: oldId });
      stats.removed++;
    }

    // Build the final ordered list and generate insert commands
    // Process new blocks in order to generate correct insertBefore references
    for (let i = 0; i < newBlocks.length; i++) {
      const block = newBlocks[i];
      const attrs = this.getBlockAttrs(block);
      
      // Check if this is a kept block
      const keepOp = keepOps.find(op => op.newIndex === i);
      
      if (keepOp) {
        // Block is kept - check if line attrs need updating
        const oldBlock = oldBlocks[keepOp.oldIndex];
        if (oldBlock.startLine !== block.startLine || oldBlock.lineCount !== block.lineCount) {
          commands.push({
            type: 'updateAttrs',
            blockId: block.id,
            attrs: {
              'data-line': block.startLine,
              'data-line-count': block.lineCount,
            },
          });
        }
      } else {
        // New block - need to insert
        // Find the next sibling that exists in DOM (a kept block after this one)
        let refId: string | null = null;
        for (let j = i + 1; j < newBlocks.length; j++) {
          const futureKeepOp = keepOps.find(op => op.newIndex === j);
          if (futureKeepOp) {
            refId = newBlocks[j].id;
            break;
          }
        }
        
        if (refId) {
          commands.push({
            type: 'insertBefore',
            blockId: block.id,
            html: '', // HTML will be set after rendering
            refId,
            attrs,
          });
        } else {
          commands.push({
            type: 'append',
            blockId: block.id,
            html: '', // HTML will be set after rendering
            attrs,
          });
        }
      }
    }

    return { commands, stats };
  }

  /**
   * Get block attributes for DOM element
   */
  private getBlockAttrs(block: BlockMeta): BlockAttrs {
    return {
      'data-block-id': block.id,
      'data-block-hash': block.hash,
      'data-line': block.startLine,
      'data-line-count': block.lineCount,
    };
  }

  /**
   * Set rendered HTML for a block by index
   */
  setBlockHtml(index: number, html: string): void {
    if (index >= 0 && index < this.blocks.length) {
      this.blocks[index].html = html;
      this.blocks[index].hasPlaceholder = html.includes('async-placeholder');
    }
  }

  /**
   * Set rendered HTML for a block by ID
   */
  setBlockHtmlById(id: string, html: string): void {
    const block = this.blocks.find(b => b.id === id);
    if (block) {
      block.html = html;
      block.hasPlaceholder = html.includes('async-placeholder');
    }
  }

  /**
   * Get blocks that need rendering (no cached HTML or has placeholder)
   */
  getBlocksNeedingRender(): { block: BlockMeta; index: number }[] {
    return this.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !block.html || block.hasPlaceholder);
  }

  /**
   * Get all block IDs in order
   */
  getBlockIds(): string[] {
    return this.blocks.map(b => b.id);
  }

  /**
   * Clear all cached HTML
   */
  clearHtmlCache(): void {
    for (const block of this.blocks) {
      block.html = undefined;
      block.hasPlaceholder = undefined;
    }
  }

  /**
   * Get full HTML content (all blocks concatenated)
   */
  getFullHtml(): string {
    return this.blocks
      .map(block => {
        if (!block.html) return '';
        return this.wrapBlockHtml(block);
      })
      .join('\n');
  }

  /**
   * Wrap block HTML with container div and attributes
   */
  wrapBlockHtml(block: BlockMeta): string {
    const attrs = this.getBlockAttrs(block);
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    return `<div class="md-block" ${attrStr}>${block.html}</div>`;
  }

  /**
   * Export document state for serialization
   */
  toJSON(): { blocks: Omit<BlockMeta, 'html' | 'hasPlaceholder'>[]; rawContent: string; idCounter: number } {
    return {
      blocks: this.blocks.map(b => ({
        id: b.id,
        hash: b.hash,
        startLine: b.startLine,
        lineCount: b.lineCount,
        content: b.content,
      })),
      rawContent: this.rawContent,
      idCounter: this.idCounter,
    };
  }

  /**
   * Create document from serialized state
   */
  static fromJSON(data: { blocks: Omit<BlockMeta, 'html' | 'hasPlaceholder'>[]; rawContent: string; idCounter: number }): MarkdownDocument {
    const doc = new MarkdownDocument();
    doc.rawContent = data.rawContent;
    doc.normalizedContent = normalizeMathBlocks(data.rawContent);
    doc.blocks = data.blocks.map(b => ({ ...b, html: undefined }));
    doc.idCounter = data.idCounter;
    return doc;
  }
}

/**
 * Chunk blocks for streaming rendering
 */
export interface Chunk {
  blocks: BlockMeta[];
  startIndex: number;
}

/**
 * Split document blocks into chunks for streaming
 */
export function chunkBlocks(blocks: readonly BlockMeta[], initialChunkSize: number = 50): Chunk[] {
  const getTargetSize = (chunkIndex: number): number => {
    return initialChunkSize * Math.pow(2, chunkIndex);
  };

  const chunks: Chunk[] = [];
  let currentBlocks: BlockMeta[] = [];
  let currentLineCount = 0;
  let startIndex = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    currentBlocks.push(block);
    currentLineCount += block.lineCount;

    const targetSize = getTargetSize(chunks.length);
    if (currentLineCount >= targetSize) {
      chunks.push({ blocks: [...currentBlocks], startIndex });
      startIndex = i + 1;
      currentBlocks = [];
      currentLineCount = 0;
    }
  }

  if (currentBlocks.length > 0) {
    chunks.push({ blocks: currentBlocks, startIndex });
  }

  return chunks;
}

/**
 * Extract title from markdown content
 */
export function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Heading info for TOC
 */
export interface HeadingInfo {
  level: number;
  text: string;
  id: string;
  line: number;
}

/**
 * Extract headings from parsed blocks (without DOM)
 */
export function extractHeadingsFromBlocks(blocks: readonly BlockMeta[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const seenIds = new Set<string>();
  
  for (const block of blocks) {
    const match = block.content.match(/^(#{1,6})\s+(.+)$/m);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      
      // Generate slug ID
      let baseId = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      
      // Handle duplicates
      let id = baseId || 'heading';
      let counter = 1;
      while (seenIds.has(id)) {
        id = `${baseId}-${counter++}`;
      }
      seenIds.add(id);
      
      headings.push({ level, text, id, line: block.startLine });
    }
  }
  
  return headings;
}

/**
 * Execute DOM commands on a container element
 * This is the only function that touches the real DOM
 */
export function executeDOMCommands(
  container: HTMLElement,
  commands: DOMCommand[],
  document: Document
): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'clear':
        container.innerHTML = '';
        break;
        
      case 'append': {
        const div = document.createElement('div');
        div.className = 'md-block';
        div.innerHTML = cmd.html;
        setBlockAttrs(div, cmd.attrs);
        container.appendChild(div);
        break;
      }
      
      case 'insertBefore': {
        const refEl = container.querySelector(`[data-block-id="${cmd.refId}"]`);
        if (refEl) {
          const div = document.createElement('div');
          div.className = 'md-block';
          div.innerHTML = cmd.html;
          setBlockAttrs(div, cmd.attrs);
          refEl.parentNode?.insertBefore(div, refEl);
        }
        break;
      }
      
      case 'remove': {
        const el = container.querySelector(`[data-block-id="${cmd.blockId}"]`);
        el?.remove();
        break;
      }
      
      case 'replace': {
        const el = container.querySelector(`[data-block-id="${cmd.blockId}"]`);
        if (el) {
          el.innerHTML = cmd.html;
          setBlockAttrs(el as HTMLElement, cmd.attrs);
        }
        break;
      }
      
      case 'updateAttrs': {
        const el = container.querySelector(`[data-block-id="${cmd.blockId}"]`);
        if (el) {
          setBlockAttrs(el as HTMLElement, cmd.attrs as BlockAttrs);
        }
        break;
      }
    }
  }
}

/**
 * Set block attributes on an element
 */
function setBlockAttrs(el: HTMLElement, attrs: Partial<BlockAttrs>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      el.setAttribute(key, String(value));
    }
  }
}

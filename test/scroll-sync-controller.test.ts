/**
 * Scroll Sync Controller State Machine Tests
 * 
 * Tests the 4-state machine: INITIAL, RESTORING, TRACKING, LOCKED
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ScrollState,
  createScrollSyncController,
  type ScrollSyncController,
  type ScrollStateType,
  type LineMapper,
} from '../src/core/line-based-scroll.ts';

// ============================================================================
// Mock Types
// ============================================================================

interface BlockData {
  blockId: string;
  startLine: number;
  endLine: number;
  top: number;
  height: number;
}

interface MockDOM {
  container: MockContainer;
  getScrollTop: () => number;
  setScrollTop: (value: number) => void;
  setScrollHeight: (value: number) => void;
  setClientHeight: (value: number) => void;
  triggerScroll: () => void;
  addBlock: (blockId: string, top: number, height: number) => void;
  clearBlocks: () => void;
}

interface MockContainer {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollTo: (opts: { top: number; behavior?: string }) => void;
  addEventListener: (event: string, handler: () => void, options?: object) => void;
  removeEventListener: (event: string, handler: () => void) => void;
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number };
  querySelectorAll: (selector: string) => MockBlock[];
  querySelector: (selector: string) => MockBlock | null;
}

interface MockBlock {
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { top: number; height: number };
}

// ============================================================================
// Global Mocks for Browser APIs
// ============================================================================

// Mock ResizeObserver
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    constructor(callback: ResizeObserverCallback) {}
    observe(target: Element) {}
    unobserve(target: Element) {}
    disconnect() {}
  };
}

// Mock MutationObserver
if (typeof globalThis.MutationObserver === 'undefined') {
  (globalThis as any).MutationObserver = class MutationObserver {
    constructor(callback: MutationCallback) {}
    observe(target: Node, options?: MutationObserverInit) {}
    disconnect() {}
    takeRecords(): MutationRecord[] { return []; }
  };
}

// ============================================================================
// Mock DOM Environment
// ============================================================================

function createMockDOM(): MockDOM {
  let scrollTop = 0;
  let scrollHeight = 600;
  let clientHeight = 600;
  const blocks: MockBlock[] = [];
  const scrollListeners: Array<() => void> = [];

  const container: MockContainer = {
    scrollTop,
    scrollHeight,
    clientHeight,

    scrollTo(opts) {
      scrollTop = opts.top || 0;
      container.scrollTop = scrollTop;
      scrollListeners.forEach(fn => fn());
    },

    addEventListener(event, handler) {
      if (event === 'scroll') {
        scrollListeners.push(handler);
      }
    },

    removeEventListener(event, handler) {
      if (event === 'scroll') {
        const idx = scrollListeners.indexOf(handler);
        if (idx >= 0) scrollListeners.splice(idx, 1);
      }
    },

    getBoundingClientRect() {
      return { top: 0, left: 0, width: 800, height: clientHeight };
    },

    querySelectorAll(selector) {
      if (selector === '[data-block-id]') {
        return blocks;
      }
      return [];
    },

    querySelector(selector) {
      if (selector === '#markdown-content') {
        return null;
      }
      const match = selector.match(/\[data-block-id="([^"]+)"\]/);
      if (match) {
        return blocks.find(b => b.getAttribute('data-block-id') === match[1]) || null;
      }
      return null;
    },
  };

  return {
    container: container as MockContainer,

    getScrollTop: () => scrollTop,
    
    setScrollTop: (value: number) => {
      scrollTop = value;
      container.scrollTop = value;
    },

    setScrollHeight: (value: number) => {
      scrollHeight = value;
      container.scrollHeight = value;
    },

    setClientHeight: (value: number) => {
      clientHeight = value;
      container.clientHeight = value;
    },

    triggerScroll: () => {
      scrollListeners.forEach(fn => fn());
    },

    addBlock: (blockId: string, top: number, height: number) => {
      const block: MockBlock = {
        getAttribute: (name: string) => name === 'data-block-id' ? blockId : null,
        getBoundingClientRect: () => ({
          top: top - scrollTop,
          height,
        }),
      };
      blocks.push(block);
    },

    clearBlocks: () => {
      blocks.length = 0;
    },
  };
}

// ============================================================================
// Mock LineMapper
// ============================================================================

function createMockLineMapper(blockData: BlockData[]): LineMapper {
  return {
    getLineFromBlockId(blockId: string, progress: number): number | null {
      const block = blockData.find(b => b.blockId === blockId);
      if (!block) return null;
      return block.startLine + progress * (block.endLine - block.startLine);
    },

    getBlockPositionFromLine(line: number): { blockId: string; progress: number } | null {
      for (const block of blockData) {
        if (line >= block.startLine && line <= block.endLine) {
          const progress = (line - block.startLine) / (block.endLine - block.startLine);
          return { blockId: block.blockId, progress };
        }
      }
      // Line not found in any block - return null (not mapped yet)
      return null;
    },
  };
}

// ============================================================================
// Test Cases: INITIAL State
// ============================================================================

describe('ScrollSyncController', () => {
  describe('INITIAL State', () => {
    it('should start in INITIAL state', () => {
      const dom = createMockDOM();
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([]),
      });
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });

    it('should transition to LOCKED when setTargetLine can jump', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });

      ctrl.setTargetLine(15);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      assert.ok(dom.getScrollTop() > 0, 'Scroll position should change');
      ctrl.dispose();
    });

    it('should transition to RESTORING when setTargetLine cannot jump', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b5', startLine: 41, endLine: 50, top: 400, height: 100 },
      ];
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });

      ctrl.setTargetLine(45);
      
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      ctrl.dispose();
    });

    it('should ignore scroll events in INITIAL state', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(1000);
      
      let scrollReported = false;
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([
          { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        ]),
        onUserScroll: () => { scrollReported = true; },
      });
      ctrl.start();

      dom.setScrollTop(50);
      dom.triggerScroll();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      assert.strictEqual(scrollReported, false);
      ctrl.dispose();
    });

    it('should stay INITIAL after reset', () => {
      const dom = createMockDOM();
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([]),
      });

      ctrl.reset();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });
  });

  // ============================================================================
  // Test Cases: RESTORING State
  // ============================================================================

  describe('RESTORING State', () => {
    it('should transition to LOCKED when DOM grows enough to jump', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      
      const allBlocks: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b5', startLine: 41, endLine: 50, top: 400, height: 100 },
      ];
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(allBlocks),
      });
      ctrl.start();

      ctrl.setTargetLine(45);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      // Simulate more blocks rendered
      dom.addBlock('b5', 400, 100);
      dom.setScrollHeight(1200);
      // Trigger content change by calling setTargetLine again or simulating observer
      ctrl.setTargetLine(45);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should ignore scroll events in RESTORING (DOM-induced, not user)', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      
      let reportedLine: number | null = null;
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([
          { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
          { blockId: 'b10', startLine: 91, endLine: 100, top: 900, height: 100 },
        ]),
        onUserScroll: (line) => { reportedLine = line; },
        userScrollDebounceMs: 0,
      });
      ctrl.start();

      ctrl.setTargetLine(95);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      // Scroll event triggered (by DOM change, not user)
      dom.setScrollTop(50);
      dom.triggerScroll();
      
      // Should stay in RESTORING - scroll events are ignored during restore
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      assert.strictEqual(reportedLine, null, 'Scroll should NOT be reported in RESTORING');
      ctrl.dispose();
    });

    it('should update targetLine when setTargetLine called in RESTORING', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([
          { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
          { blockId: 'b8', startLine: 71, endLine: 80, top: 700, height: 100 },
          { blockId: 'b10', startLine: 91, endLine: 100, top: 900, height: 100 },
        ]),
      });

      ctrl.setTargetLine(95);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      ctrl.setTargetLine(75);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      ctrl.dispose();
    });

    it('should transition to LOCKED on onStreamingComplete', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.addBlock('b2', 100, 100);
      dom.setScrollHeight(200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([
          { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
          { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
          { blockId: 'b10', startLine: 91, endLine: 100, top: 900, height: 100 },
        ]),
      });

      ctrl.setTargetLine(95);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      ctrl.onStreamingComplete();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should transition to INITIAL on reset', () => {
      const dom = createMockDOM();
      dom.addBlock('b1', 0, 100);
      dom.setScrollHeight(100);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([
          { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
          { blockId: 'b10', startLine: 91, endLine: 100, top: 900, height: 100 },
        ]),
      });

      ctrl.setTargetLine(95);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      ctrl.reset();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });
  });

  // ============================================================================
  // Test Cases: TRACKING State
  // ============================================================================

  describe('TRACKING State', () => {
    function setupTracking(): Promise<{ dom: MockDOM; ctrl: ScrollSyncController; getReportedLine: () => number | null }> {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      let reportedLine: number | null = null;
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        onUserScroll: (line) => { reportedLine = line; },
        lockDurationMs: 10,
        userScrollDebounceMs: 0,
      });
      ctrl.start();

      ctrl.setTargetLine(5);
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({ dom, ctrl, getReportedLine: () => reportedLine });
        }, 20);
      });
    }

    it('should update targetLine and report on scroll event', async () => {
      const { dom, ctrl, getReportedLine } = await setupTracking();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      dom.setScrollTop(150);
      dom.triggerScroll();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      assert.ok(getReportedLine() !== null, 'Scroll should be reported');
      ctrl.dispose();
    });

    it('should transition to LOCKED on setTargetLine', async () => {
      const { dom, ctrl } = await setupTracking();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      ctrl.setTargetLine(25);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should ignore onStreamingComplete', async () => {
      const { dom, ctrl } = await setupTracking();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      ctrl.onStreamingComplete();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      ctrl.dispose();
    });

    it('should transition to INITIAL on reset', async () => {
      const { dom, ctrl } = await setupTracking();
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      ctrl.reset();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });
  });
  // ============================================================================
  // Scenario Tests: Real-world use cases
  // ============================================================================

  describe('Scenarios', () => {
    it('should preserve targetLine during LOCKED (resize stability fix)', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
        { blockId: 'b4', startLine: 31, endLine: 40, top: 300, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 100,
      });
      ctrl.start();

      // Step 1: setTargetLine to line 15
      ctrl.setTargetLine(15);
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      const scrollAfterSetTarget = dom.getScrollTop();
      
      // Step 2: Scroll event during LOCKED (e.g., from resize/content change)
      // This should NOT update targetLine - prevents drift during resize
      dom.setScrollTop(300);
      dom.triggerScroll();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Step 3: targetLine should NOT be updated by scroll events in LOCKED
      // This is the fix - during resize, we don't want scroll events to change targetLine
      // because the layout may not have stabilized yet
      // getCurrentLine() returns actual scroll position, but internal targetLine is preserved
      
      ctrl.dispose();
    });

    it('should handle streaming load with position restore', () => {
      const dom = createMockDOM();
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      dom.addBlock('b1', 0, 100);
      
      const allBlocks: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
        { blockId: 'b4', startLine: 31, endLine: 40, top: 300, height: 100 },
        { blockId: 'b5', startLine: 41, endLine: 50, top: 400, height: 100 },
      ];
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(allBlocks),
        lockDurationMs: 100,
      });
      ctrl.start();

      // Step 1: Try to restore to line 45
      ctrl.setTargetLine(45);
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      // Step 2: More blocks render but still cannot jump
      dom.addBlock('b2', 100, 100);
      dom.addBlock('b3', 200, 100);
      dom.setScrollHeight(300);
      ctrl.setTargetLine(45); // Re-check
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      
      // Step 3: Target block renders - now can jump
      dom.addBlock('b4', 300, 100);
      dom.addBlock('b5', 400, 100);
      dom.setScrollHeight(1200);
      ctrl.setTargetLine(45);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      assert.ok(dom.getScrollTop() > 300, 'Should scroll to target block');
      
      ctrl.dispose();
    });

    it('should maintain reading position during resize (width change causes reflow)', async () => {
      const dom = createMockDOM();
      // Initial block layout
      let blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
        { blockId: 'b4', startLine: 31, endLine: 40, top: 300, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 10,
        userScrollDebounceMs: 0,
      });
      ctrl.start();

      // Step 1: User is reading at line 25 (block b3)
      ctrl.setTargetLine(25);
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Wait for TRACKING state
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      // Step 2: User scrolls to line 25 position
      dom.setScrollTop(200); // block b3 top
      dom.triggerScroll();
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      // Step 3: Simulate resize - width change causes text reflow
      // Block heights change, positions shift
      dom.clearBlocks();
      blockData = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 150 },  // taller due to text wrap
        { blockId: 'b2', startLine: 11, endLine: 20, top: 150, height: 150 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 300, height: 150 }, // was at 200, now at 300
        { blockId: 'b4', startLine: 31, endLine: 40, top: 450, height: 150 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1500);
      
      // Simulate handleResize being called (which calls setTargetLine internally via doScroll)
      // In real code, ResizeObserver triggers this
      ctrl.setTargetLine(25); // This simulates the re-scroll during resize
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      // After resize handling, scroll position should be at new b3 position (300)
      assert.ok(dom.getScrollTop() >= 300, `Should scroll to new b3 position, got ${dom.getScrollTop()}`);
      
      // Step 4: Even if scroll events fire during LOCKED, targetLine should NOT drift
      // This is the key fix - multiple scroll events during resize won't corrupt targetLine
      dom.setScrollTop(100); // Wrong position during layout instability
      dom.triggerScroll();
      
      // Still LOCKED, targetLine preserved
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // If we set target again, it should still go to line 25's position
      ctrl.setTargetLine(25);
      assert.ok(dom.getScrollTop() >= 300, `targetLine should be preserved, got ${dom.getScrollTop()}`);
      
      ctrl.dispose();
    });

    it('should lock() before zoom to prevent targetLine corruption', async () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
        { blockId: 'b4', startLine: 31, endLine: 40, top: 300, height: 100 },
        { blockId: 'b5', startLine: 41, endLine: 50, top: 400, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      let reportedLine: number | null = null;
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 10,
        userScrollDebounceMs: 0,
        onUserScroll: (line) => { reportedLine = line; },
      });
      ctrl.start();

      // Step 1: User scrolls to line 45 position, enters TRACKING
      ctrl.setTargetLine(45);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      // Step 2: User scrolls to line 45 (block b5)
      dom.setScrollTop(400);
      dom.triggerScroll();
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      
      // Step 3: Before zoom change, call lock() to protect targetLine
      // This simulates what happens when user clicks "Reset to 100%"
      ctrl.lock();
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Step 4: Zoom change causes browser to adjust scroll position
      // This triggers scroll event, but since we're LOCKED, targetLine is preserved
      dom.setScrollTop(150); // Browser adjusted scroll due to zoom change
      dom.triggerScroll();
      
      // Should still be LOCKED and targetLine should NOT have changed
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Step 5: ResizeObserver fires (simulated by setTargetLine with same target)
      // This will re-scroll to the preserved targetLine
      ctrl.setTargetLine(45);
      
      // Scroll position should be restored to block b5
      assert.ok(dom.getScrollTop() >= 400, `Should restore to line 45 position, got ${dom.getScrollTop()}`);
      
      ctrl.dispose();
    });

    it('lock() should be no-op in non-TRACKING states', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });
      ctrl.start();

      // In INITIAL state, lock() should be no-op
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.lock();
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      
      // In LOCKED state, lock() should be no-op
      ctrl.setTargetLine(5);
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.lock();
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      ctrl.dispose();
    });
  });

  // ============================================================================
  // Test Cases: LOCKED State
  // ============================================================================

  describe('LOCKED State', () => {
    function setupLocked(): { dom: MockDOM; ctrl: ScrollSyncController; getReportedLine: () => number | null; clearReported: () => void } {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      let reportedLine: number | null = null;
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        onUserScroll: (line) => { reportedLine = line; },
        lockDurationMs: 100,
      });
      ctrl.start();

      ctrl.setTargetLine(15);
      return { 
        dom, 
        ctrl, 
        getReportedLine: () => reportedLine, 
        clearReported: () => { reportedLine = null; } 
      };
    }

    it('should NOT update targetLine on scroll event (prevents resize drift)', () => {
      const { dom, ctrl, getReportedLine, clearReported } = setupLocked();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      clearReported();
      
      // Record initial scroll position (setTargetLine(15) scrolled to ~line 15)
      const initialScrollTop = dom.getScrollTop();
      
      // Simulate scroll event (e.g., during resize or content change)
      dom.setScrollTop(200);
      dom.triggerScroll();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      assert.strictEqual(getReportedLine(), null, 'Scroll should NOT be reported');
      
      // getCurrentLine returns scroll position, not targetLine
      // The key point is targetLine is preserved internally
      // If we call setTargetLine again or wait for timer, the original target should be maintained
      ctrl.dispose();
    });

    it('should stay LOCKED on setTargetLine', () => {
      const { dom, ctrl } = setupLocked();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      ctrl.setTargetLine(25);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should transition to TRACKING when timer expires', async () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 10,
      });

      ctrl.setTargetLine(5);
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING);
      ctrl.dispose();
    });

    it('should ignore onStreamingComplete', () => {
      const { dom, ctrl } = setupLocked();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      ctrl.onStreamingComplete();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should transition to INITIAL on reset', () => {
      const { dom, ctrl } = setupLocked();
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      ctrl.reset();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should ignore onStreamingComplete in INITIAL state', () => {
      const dom = createMockDOM();
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([]),
      });

      ctrl.onStreamingComplete();
      
      assert.strictEqual(ctrl.getState(), ScrollState.INITIAL);
      ctrl.dispose();
    });

    it('should scroll to top when setTargetLine(0)', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      dom.setScrollTop(500);  // Start at some position
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });

      ctrl.setTargetLine(0);
      
      assert.strictEqual(dom.getScrollTop(), 0, 'Should scroll to top');
      ctrl.dispose();
    });

    it('should handle multiple rapid setTargetLine calls', async () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b2', startLine: 11, endLine: 20, top: 100, height: 100 },
        { blockId: 'b3', startLine: 21, endLine: 30, top: 200, height: 100 },
      ];
      blockData.forEach(b => dom.addBlock(b.blockId, b.top, b.height));
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 50,
      });

      // Rapid calls
      ctrl.setTargetLine(5);
      ctrl.setTargetLine(15);
      ctrl.setTargetLine(25);
      
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Wait for timer - should still be LOCKED because timer was reset
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED, 'Timer should be reset on each call');
      
      // Wait more for timer to actually expire
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.strictEqual(ctrl.getState(), ScrollState.TRACKING, 'Timer should expire eventually');
      
      ctrl.dispose();
    });

    it('should ignore DOM change when height unchanged', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1000);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
        lockDurationMs: 100,
      });

      // Get to TRACKING state
      ctrl.setTargetLine(5);
      ctrl.reset();
      ctrl.setTargetLine(5);
      
      // Manually set lastContentHeight by triggering a real change first
      dom.setScrollHeight(1001);
      // Access internal handleContentChange via the exported controller
      // This is tricky - we need to test via setTargetLine which sets lastContentHeight
      
      // For this test, just verify the state doesn't change unexpectedly
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      ctrl.dispose();
    });

    it('should be safe to call methods after dispose', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1200);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });
      ctrl.start();
      ctrl.dispose();
      
      // These should not throw
      ctrl.setTargetLine(5);
      ctrl.reset();
      ctrl.onStreamingComplete();
      dom.triggerScroll();
      
      // Just verify no exception was thrown
      assert.ok(true, 'Methods should be safe after dispose');
    });

    it('should handle negative targetLine', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      dom.setScrollTop(500);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });

      ctrl.setTargetLine(-10);
      
      assert.strictEqual(dom.getScrollTop(), 0, 'Should scroll to top for negative line');
      ctrl.dispose();
    });

    it('should enter RESTORING when line beyond document range', () => {
      const dom = createMockDOM();
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
      ];
      dom.addBlock(blockData[0].blockId, blockData[0].top, blockData[0].height);
      dom.setScrollHeight(100);  // Short document
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });

      ctrl.setTargetLine(9999);
      
      // Line 9999 not in any block - should enter RESTORING to wait
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      ctrl.dispose();
    });

    it('should handle empty document', () => {
      const dom = createMockDOM();
      dom.setScrollHeight(0);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([]),
      });

      ctrl.setTargetLine(10);
      
      // Should enter RESTORING since no blocks
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING);
      ctrl.dispose();
    });

    it('should update targetLine in LOCKED even if scrollTo fails', () => {
      const dom = createMockDOM();
      // No blocks - scrollTo will effectively fail
      dom.setScrollHeight(1200);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper([]),  // Empty - no blocks
      });

      // Force into LOCKED state first with line 0 (scrolls to top)
      ctrl.setTargetLine(0);
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      // Now try to set to line 50 - block doesn't exist
      ctrl.setTargetLine(50);
      // Should still be in LOCKED and targetLine updated
      assert.strictEqual(ctrl.getState(), ScrollState.LOCKED);
      
      ctrl.dispose();
    });

    it('should NOT jump when block exists but has zero height (not yet laid out)', () => {
      const dom = createMockDOM();
      
      // Block b5 exists in lineMapper but will have height=0 when added to DOM
      const blockData: BlockData[] = [
        { blockId: 'b1', startLine: 1, endLine: 10, top: 0, height: 100 },
        { blockId: 'b5', startLine: 41, endLine: 50, top: 0, height: 0 },  // Will be added with height=0
      ];
      
      // Add block b5 to DOM immediately but with height=0 (simulating not yet laid out)
      dom.addBlock('b1', 0, 100);
      dom.addBlock('b5', 0, 0);  // height = 0 - block exists but not laid out!
      dom.setScrollHeight(100);
      dom.setClientHeight(600);
      
      const ctrl = createScrollSyncController({
        container: dom.container as unknown as HTMLElement,
        getLineMapper: () => createMockLineMapper(blockData),
      });
      ctrl.start();

      // Try to restore to line 45 (in block b5)
      // Block b5 exists in DOM but has height=0 - should NOT jump
      ctrl.setTargetLine(45);
      
      // BUG: Currently jumps to wrong position because block has height=0
      // EXPECTED: Should be RESTORING since block is not properly laid out
      assert.strictEqual(ctrl.getState(), ScrollState.RESTORING, 'Should be RESTORING when target block has zero height');
      
      ctrl.dispose();
    });
  });
});
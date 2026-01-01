import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  normalizeMathBlocks,
  splitMarkdownIntoBlocks,
  splitMarkdownIntoBlocksWithLines,
  escapeHtml,
  processTablesForWordCompatibility,
  extractTitle,
  AsyncTaskManager,
} from '../src/core/markdown-processor.ts';
import { hashCode } from '../src/utils/hash.ts';

describe('markdown-processor', () => {
  describe('normalizeMathBlocks', () => {
    it('should convert single-line $$ to multi-line', () => {
      const input = '$$x=1$$';
      const result = normalizeMathBlocks(input);
      assert.ok(result.includes('\n$$\nx=1\n$$\n'), 'Should expand to multi-line');
    });

    it('should not change already multi-line math blocks', () => {
      const input = '$$\nx=1\n$$';
      const result = normalizeMathBlocks(input);
      assert.strictEqual(result, input);
    });

    it('should handle multiple math blocks', () => {
      const input = '$$a+b$$\n\n$$c+d$$';
      const result = normalizeMathBlocks(input);
      assert.ok(result.includes('a+b'), 'Should contain first formula');
      assert.ok(result.includes('c+d'), 'Should contain second formula');
    });

    it('should handle math with spaces', () => {
      const input = '$$  x + y  $$';
      const result = normalizeMathBlocks(input);
      assert.ok(result.includes('x + y'), 'Should preserve formula content');
    });

    it('should not affect inline math', () => {
      const input = 'This is $x=1$ inline math';
      const result = normalizeMathBlocks(input);
      assert.strictEqual(result, input, 'Inline math should not be changed');
    });
  });

  describe('escapeHtml', () => {
    it('should escape < and >', () => {
      assert.strictEqual(escapeHtml('<div>'), '&lt;div&gt;');
    });

    it('should escape &', () => {
      assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
    });

    it('should escape quotes', () => {
      assert.strictEqual(escapeHtml('"\''), '&quot;&#039;');
    });

    it('should handle empty string', () => {
      assert.strictEqual(escapeHtml(''), '');
    });

    it('should handle multiple special characters', () => {
      assert.strictEqual(escapeHtml('<a href="test">'), '&lt;a href=&quot;test&quot;&gt;');
    });

    it('should handle text without special characters', () => {
      assert.strictEqual(escapeHtml('hello world'), 'hello world');
    });
  });

  describe('processTablesForWordCompatibility', () => {
    it('should wrap tables with center div', () => {
      const input = '<table><tr><td>test</td></tr></table>';
      const result = processTablesForWordCompatibility(input);
      assert.ok(result.includes('<div align="center">'), 'Should have center div');
      assert.ok(result.includes('table align="center"'), 'Table should have align');
      assert.ok(result.includes('</table></div>'), 'Should close properly');
    });

    it('should handle multiple tables', () => {
      const input = '<table></table><p>text</p><table></table>';
      const result = processTablesForWordCompatibility(input);
      const matches = result.match(/<div align="center">/g);
      assert.strictEqual(matches?.length, 2, 'Should wrap both tables');
    });

    it('should not affect non-table content', () => {
      const input = '<p>no table here</p>';
      const result = processTablesForWordCompatibility(input);
      assert.strictEqual(result, input);
    });
  });

  describe('extractTitle', () => {
    it('should extract h1 title', () => {
      assert.strictEqual(extractTitle('# Hello World'), 'Hello World');
    });

    it('should extract first h1 from multi-line', () => {
      assert.strictEqual(extractTitle('Some text\n# Title\nMore text'), 'Title');
    });

    it('should return null if no title', () => {
      assert.strictEqual(extractTitle('No heading here'), null);
    });

    it('should trim whitespace', () => {
      assert.strictEqual(extractTitle('#   Spaced Title   '), 'Spaced Title');
    });

    it('should not match ## as h1', () => {
      assert.strictEqual(extractTitle('## Not H1'), null);
    });

    it('should handle empty input', () => {
      assert.strictEqual(extractTitle(''), null);
    });

    it('should extract first h1 when multiple exist', () => {
      assert.strictEqual(extractTitle('# First\n# Second'), 'First');
    });
  });

  describe('hashCode', () => {
    it('should return consistent hash', () => {
      const hash1 = hashCode('test');
      const hash2 = hashCode('test');
      assert.strictEqual(hash1, hash2);
    });

    it('should return different hash for different content', () => {
      const hash1 = hashCode('test1');
      const hash2 = hashCode('test2');
      assert.notStrictEqual(hash1, hash2);
    });

    it('should return hex string', () => {
      const hash = hashCode('test');
      assert.ok(/^[0-9a-f]+$/.test(hash), 'Hash should be hex string');
    });

    it('should handle empty string', () => {
      const hash = hashCode('');
      assert.ok(hash.length > 0, 'Should return non-empty hash');
    });

    it('should handle unicode', () => {
      const hash1 = hashCode('你好');
      const hash2 = hashCode('你好');
      assert.strictEqual(hash1, hash2);
    });
  });

  describe('AsyncTaskManager', () => {
    it('should generate unique IDs', () => {
      const manager = new AsyncTaskManager();
      const id1 = manager.generateId();
      const id2 = manager.generateId();
      assert.notStrictEqual(id1, id2);
      assert.ok(id1.startsWith('async-placeholder-'));
      assert.ok(id2.startsWith('async-placeholder-'));
    });

    it('should start with pending count 0', () => {
      const manager = new AsyncTaskManager();
      assert.strictEqual(manager.pendingCount, 0);
    });

    it('should not be aborted initially', () => {
      const manager = new AsyncTaskManager();
      assert.strictEqual(manager.isAborted(), false);
    });

    it('should set aborted flag on abort', () => {
      const manager = new AsyncTaskManager();
      manager.abort();
      assert.strictEqual(manager.isAborted(), true);
    });

    it('should reset state on reset', () => {
      const manager = new AsyncTaskManager();
      manager.generateId();
      manager.abort();
      manager.reset();
      assert.strictEqual(manager.isAborted(), false);
      // IDs should restart
      const newId = manager.generateId();
      assert.strictEqual(newId, 'async-placeholder-1');
    });

    it('should create tasks with placeholder', () => {
      const manager = new AsyncTaskManager();
      const { task, placeholder } = manager.createTask(
        async () => {},
        { code: 'test' },
        null,
        'ready'
      );
      assert.ok(task.id.startsWith('async-placeholder-'));
      assert.strictEqual(placeholder.type, 'html');
      assert.ok(placeholder.value.includes(task.id));
      assert.strictEqual(manager.pendingCount, 1);
    });

    it('should handle translate function', () => {
      const translate = (key) => `translated:${key}`;
      const manager = new AsyncTaskManager(translate);
      const { placeholder } = manager.createTask(async () => {}, {}, null, 'ready');
      // Placeholder should use translation
      assert.ok(placeholder.value.length > 0);
    });

    it('should process empty queue', async () => {
      const manager = new AsyncTaskManager();
      const result = await manager.processAll();
      assert.strictEqual(result, true);
    });

    it('should track task context for cancellation', () => {
      const manager = new AsyncTaskManager();
      const context1 = manager.getContext();
      assert.strictEqual(context1.cancelled, false);

      manager.abort();
      assert.strictEqual(context1.cancelled, true);

      manager.reset();
      const context2 = manager.getContext();
      assert.strictEqual(context2.cancelled, false);
      // Old context should still be cancelled
      assert.strictEqual(context1.cancelled, true);
    });
  });

  describe('Block Hash Consistency', () => {
    it('should produce same hash for identical blocks', () => {
      const block = '# Title\n\nSome content here.';
      const hash1 = hashCode(block);
      const hash2 = hashCode(block);
      assert.strictEqual(hash1, hash2);
    });

    it('should produce different hash for different blocks', () => {
      const block1 = '# Title';
      const block2 = '# Different Title';
      const hash1 = hashCode(block1);
      const hash2 = hashCode(block2);
      assert.notStrictEqual(hash1, hash2);
    });

    it('should detect whitespace differences', () => {
      const block1 = '# Title';
      const block2 = '#  Title';
      const hash1 = hashCode(block1);
      const hash2 = hashCode(block2);
      assert.notStrictEqual(hash1, hash2);
    });
  });

  describe('Incremental Update Simulation', () => {
    // Simulate the block-based diff logic without DOM
    function simulateBlockDiff(oldMd, newMd) {
      const oldBlocks = splitMarkdownIntoBlocksWithLines(normalizeMathBlocks(oldMd));
      const newBlocks = splitMarkdownIntoBlocksWithLines(normalizeMathBlocks(newMd));

      const oldHashes = oldBlocks.map((b) => hashCode(b.content));
      const newHashes = newBlocks.map((b) => hashCode(b.content));

      const changes = {
        unchanged: 0,
        added: 0,
        removed: 0,
        modified: 0,
      };

      // Simple diff: count matches
      const oldSet = new Set(oldHashes);
      const newSet = new Set(newHashes);

      for (const hash of newHashes) {
        if (oldSet.has(hash)) {
          changes.unchanged++;
        } else {
          changes.added++;
        }
      }

      for (const hash of oldHashes) {
        if (!newSet.has(hash)) {
          changes.removed++;
        }
      }

      return changes;
    }

    it('should detect no changes for identical content', () => {
      const md = '# Title\n\nParagraph';
      const changes = simulateBlockDiff(md, md);
      assert.strictEqual(changes.added, 0);
      assert.strictEqual(changes.removed, 0);
      assert.ok(changes.unchanged > 0);
    });

    it('should detect added blocks', () => {
      const oldMd = '# Title';
      const newMd = '# Title\n\nNew paragraph';
      const changes = simulateBlockDiff(oldMd, newMd);
      assert.ok(changes.added > 0, 'Should have added blocks');
    });

    it('should detect removed blocks', () => {
      const oldMd = '# Title\n\nParagraph';
      const newMd = '# Title';
      const changes = simulateBlockDiff(oldMd, newMd);
      assert.ok(changes.removed > 0, 'Should have removed blocks');
    });

    it('should handle complex edits', () => {
      const oldMd = `# Title

Paragraph 1

Paragraph 2

Paragraph 3`;
      const newMd = `# Title

Paragraph 1

Modified paragraph

Paragraph 3`;
      const changes = simulateBlockDiff(oldMd, newMd);
      // Title, Para 1, and Para 3 unchanged; Para 2 removed; Modified added
      assert.strictEqual(changes.unchanged, 3);
      assert.strictEqual(changes.added, 1);
      assert.strictEqual(changes.removed, 1);
    });

    it('should preserve block boundaries after edit', () => {
      const md1 = '# Title\n\n```js\ncode\n```\n\nText';
      const md2 = '# Title\n\n```js\ncode modified\n```\n\nText';

      const blocks1 = splitMarkdownIntoBlocksWithLines(md1);
      const blocks2 = splitMarkdownIntoBlocksWithLines(md2);

      assert.strictEqual(blocks1.length, blocks2.length, 'Block count should be same');
      assert.strictEqual(blocks1[0].content, blocks2[0].content, 'Title unchanged');
      assert.notStrictEqual(blocks1[1].content, blocks2[1].content, 'Code block changed');
      assert.strictEqual(blocks1[2].content, blocks2[2].content, 'Text unchanged');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long lines', () => {
      const longLine = 'x'.repeat(10000);
      const result = splitMarkdownIntoBlocks(longLine);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].length, 10000);
    });

    it('should handle many small blocks', () => {
      const blocks = [];
      for (let i = 0; i < 1000; i++) {
        blocks.push(`Block ${i}`);
      }
      const md = blocks.join('\n\n');
      const result = splitMarkdownIntoBlocks(md);
      assert.strictEqual(result.length, 1000);
    });

    it('should handle unicode content', () => {
      const md = '# 标题\n\n你好世界\n\n日本語テスト';
      const result = splitMarkdownIntoBlocks(md);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0], '# 标题');
    });

    it('should handle mixed line endings', () => {
      const md = '# Title\r\n\r\nParagraph\n\nMore';
      const result = splitMarkdownIntoBlocks(md);
      assert.ok(result.length >= 2);
    });

    it('should handle nested structures', () => {
      const md = `> Blockquote
> with multiple lines
>
> > Nested quote`;
      const result = splitMarkdownIntoBlocks(md);
      assert.strictEqual(result.length, 1, 'Nested blockquote should be one block');
    });
  });
});

/**
 * Remark plugin to filter out [toc] markers in rendered HTML
 * The [toc] marker is used in DOCX export but should not be visible in HTML rendering
 */

import { visit, SKIP, type Index, type ActionTuple } from 'unist-util-visit';
import type { Node } from 'unist';

interface TextNode extends Node {
  type: 'text';
  value: string;
}

interface ParagraphNode extends Node {
  type: 'paragraph';
  children: Node[];
}

interface ParentNode extends Node {
  children: Node[];
}

/**
 * Plugin to remove [toc] markers from the AST
 * Removes paragraphs that contain only [toc] or variations like [TOC]
 */
export default function remarkTocFilter() {
  return (tree: Node) => {
    visit(tree, 'paragraph', (node: ParagraphNode, index, parent): void | ActionTuple => {
      if (!parent || index === undefined) return;

      // Check if paragraph contains only a [toc] marker
      if (node.children && node.children.length === 1) {
        const child = node.children[0];
        if (child.type === 'text') {
          const textNode = child as TextNode;
          const trimmed = textNode.value.trim();
          
          // Match [toc] or [TOC] case-insensitively
          if (/^\[toc\]$/i.test(trimmed)) {
            // Remove this paragraph node
            (parent as ParentNode).children.splice(index, 1);
            return [SKIP, index];
          }
        }
      }
    });
  };
}

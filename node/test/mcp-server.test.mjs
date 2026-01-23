/**
 * MCP Server Test
 * Tests the md2x MCP server functionality
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('MCP Server - Full Integration Test', async (t) => {
  // Start the MCP server
  const server = spawn('node', [join(__dirname, '../dist/md2x.js'), '--mcp'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  let responseBuffer = '';
  let requestId = 1;
  const responses = [];

  server.stdout.on('data', (data) => {
    responseBuffer += data.toString();

    // Try to parse complete JSON-RPC messages
    const lines = responseBuffer.split('\n');
    responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          responses.push(response);
        } catch (e) {
          console.error('Failed to parse response:', line);
        }
      }
    }
  });

  function sendRequest(method, params = {}) {
    const request = {
      jsonrpc: '2.0',
      id: requestId++,
      method,
      params
    };

    server.stdin.write(JSON.stringify(request) + '\n');
    return new Promise((resolve) => {
      const checkResponse = () => {
        const response = responses.find(r => r.id === request.id);
        if (response) {
          resolve(response);
        } else {
          setTimeout(checkResponse, 100);
        }
      };
      checkResponse();
    });
  }

  try {
    // Test 1: Initialize
    await t.test('Initialize MCP connection', async () => {
      const response = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      });

      assert.strictEqual(response.result.protocolVersion, '2024-11-05');
      assert.strictEqual(response.result.serverInfo.name, 'md2x-mcp-server');
      assert.ok(response.result.capabilities.tools);
    });

    // Test 2: List tools
    await t.test('List available tools', async () => {
      const response = await sendRequest('tools/list');

      assert.ok(response.result.tools);
      assert.strictEqual(response.result.tools.length, 2);

      const convertTool = response.result.tools.find(t => t.name === 'convert_markdown');
      assert.ok(convertTool);
      assert.strictEqual(convertTool.inputSchema.required[0], 'markdownFilePath');

      const themesTool = response.result.tools.find(t => t.name === 'list_themes');
      assert.ok(themesTool);
    });

    // Test 3: List themes
    await t.test('List themes', async () => {
      const response = await sendRequest('tools/call', {
        name: 'list_themes',
        arguments: {}
      });

      assert.ok(response.result.content);
      const content = JSON.parse(response.result.content[0].text);
      assert.ok(content.themes);
      assert.ok(content.count > 0);
      assert.ok(Array.isArray(content.themes));
    });

    // Test 4: Convert markdown using markdownFilePath
    await t.test('Convert markdown to HTML', async () => {
      const markdownFilePath = join(__dirname, './fixtures/test-mcp.md');

      const response = await sendRequest('tools/call', {
        name: 'convert_markdown',
        arguments: {
          markdownFilePath,
          format: 'html',
          theme: 'default',
          title: 'Test Document'
        }
      });

      assert.ok(response.result.content);
      const content = JSON.parse(response.result.content[0].text);
      assert.strictEqual(content.format, 'html');
      assert.ok(content.outputPath);
      assert.ok(content.size > 0);
      assert.ok(content.message.includes('Successfully converted'));
    });

  } finally {
    // Clean up
    server.kill();
  }
});

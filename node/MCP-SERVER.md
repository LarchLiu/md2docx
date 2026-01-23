# MCP Server for md2x

This document describes the Model Context Protocol (MCP) server implementation for the md2x markdown converter.

## Overview

The md2x MCP server exposes markdown conversion capabilities via the Model Context Protocol, allowing AI assistants and other MCP clients to convert markdown content to various formats (PDF, DOCX, HTML, PNG, JPG, JPEG, WEBP).

## Installation

The MCP server is built into the md2x CLI. Install dependencies:

```bash
cd node
pnpm install
pnpm build
```

## Usage

### Starting the MCP Server

Start the server in MCP mode using the `--mcp` flag:

```bash
node dist/md2x.js --mcp
```

Or if installed globally:

```bash
md2x --mcp
```

The server uses stdio transport for communication, making it compatible with any MCP client.

## Available Tools

### 1. convert_markdown

Convert markdown files to PDF, DOCX, HTML, or Image formats.

**Parameters:**
- `markdownFilePath` (string, required): Path to markdown file to convert
- `format` (string, default: "pdf"): Output format (pdf, docx, html, png, jpg, jpeg, webp)
- `theme` (string, default: "default"): Theme name to apply
- `diagramMode` (string, optional): Diagram rendering mode (img, live, none)
- `hrAsPageBreak` (boolean, optional): Convert horizontal rules to page breaks
- `title` (string, optional): Document title
- `basePath` (string, optional): Base path for resolving relative paths
- `liveRuntime` (string, optional): HTML live runtime injection strategy (inline, cdn)
- `liveRuntimeBaseUrl` (string, optional): Custom runtime base URL when liveRuntime is cdn
- `outputPath` (string, optional): Output file path (defaults to same directory as markdown file)

**Returns:**
JSON object containing:
- `format`: The output format used
- `outputPath`: Path to the converted file
- `size`: Size of the file in bytes
- `message`: Success message

For split images (multiple parts):
- `outputPath`: Path to the first part
- `outputPaths`: Array of all part paths
- `parts`: Number of parts
- `size`: Total size of all parts

**Example:**
```json
{
  "name": "convert_markdown",
  "arguments": {
    "markdownFilePath": "/path/to/document.md",
    "format": "pdf",
    "theme": "academic",
    "title": "My Document"
  }
}
```

### 2. list_themes

List all available themes for markdown conversion.

**Parameters:** None

**Returns:**
JSON object containing:
- `themes`: Array of theme objects with `id`, `category`, and `featured` status
- `count`: Total number of themes

**Example:**
```json
{
  "name": "list_themes",
  "arguments": {}
}
```

## Features

- **Multiple Output Formats**: PDF, DOCX, HTML, PNG, JPG, JPEG, WEBP
- **Rich Markdown Support**:
  - Diagrams (Mermaid, Graphviz, Vega)
  - Math equations (KaTeX)
  - Code highlighting
  - Tables, images, and more
- **Themes**: 30+ built-in themes
- **Stdio Transport**: Compatible with any MCP client

## Testing

Run the MCP server tests using Node's built-in test runner:

```bash
node --test test/mcp-server.test.mjs
```

Or run all tests:

```bash
pnpm test
```

The test suite verifies:
1. MCP connection initialization
2. Tool listing functionality
3. Theme listing
4. Markdown file conversion to HTML

## Integration with Claude Desktop

To use this MCP server with Claude Desktop, add the following to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "md2x": {
      "command": "node",
      "args": ["/path/to/markdown-viewer-extension/node/dist/md2x.js", "--mcp"]
    }
  }
}
```

Replace `/path/to/markdown-viewer-extension` with the actual path to your installation.

## Implementation Details

### Files

- [src/host/mcp-server.ts](src/host/mcp-server.ts): MCP server implementation
- [src/host/cli.ts](src/host/cli.ts): CLI with MCP mode support
- [test/mcp-server.test.mjs](test/mcp-server.test.mjs): Test suite for MCP server

### Architecture

The MCP server:
1. Uses `@modelcontextprotocol/sdk` for MCP protocol handling
2. Implements stdio transport for communication
3. Reads markdown files from disk and converts them using the `convert()` API
4. Saves converted files to disk (same directory as source file by default)
5. Returns file paths to the converted documents

### Dependencies

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `zod`: Schema validation for tool parameters

## Troubleshooting

### Server not starting

Ensure all dependencies are installed:
```bash
pnpm install
pnpm build
```

### Conversion errors

Check that:
- Puppeteer is properly installed
- The markdown file exists and is readable
- The markdown content is valid
- The specified theme exists (use `list_themes` to see available themes)
- The output directory is writable

### Connection issues

The server uses stdio transport. Ensure your MCP client is configured to communicate via stdin/stdout.

## License

ISC

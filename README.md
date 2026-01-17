# md2x

Markdown → PDF/DOCX/HTML converter (local, no server). Supports Mermaid/Graphviz/Infographic/Vega/HTML/SVG rendering, math, and code highlighting.

[![npm version](https://img.shields.io/npm/v/md2x.svg?style=flat-square)](https://www.npmjs.com/package/md2x)

## CLI Options

| Option | Alias | Description | Default | Values |
|--------|-------|-------------|---------|--------|
| `--help` | `-h` | Show help message | - | - |
| `--version` | `-v` | Show version number | - | - |
| `--output` | `-o` | Output file path | Input name with format extension | File path |
| `--format` | `-f` | Output format | `pdf` | `pdf`, `docx`, `html` |
| `--theme` | `-t` | Theme name | `default` | See `--list-themes` |
| `--diagram-mode` | - | HTML diagram rendering mode | `live` | `img`, `live`, `none` |
| `--hr-page-break` | - | Convert horizontal rules to page breaks | `true` for PDF/DOCX, `false` for HTML | `true`, `false` |
| `--list-themes` | - | List all available themes | - | - |

### Diagram Modes (HTML only)

- **`live`** (default): Render diagrams in the browser on load using online CDN scripts (Mermaid, @viz-js/viz, Vega-Lite, Infographic)
- **`img`**: Pre-render diagrams as embedded images (offline, stable)
- **`none`**: Keep diagram source blocks only (no rendering)

## Usage

Export to PDF:
```bash
npx md2x input.md
```

Export to DOCX:

```bash
npx md2x input.md -f docx
```

Export to HTML:

```bash
npx md2x input.md -f html
```

List themes:

```bash
npx md2x --list-themes
```

Use a theme:

```bash
npx md2x input.md -o output.pdf --theme academic
```

Help:

```bash
npx md2x -h
```

## MCP server (Model Context Protocol)

This repo includes an Express-based MCP server that exposes `md2x` as MCP tools over HTTP, so MCP clients can convert Markdown and download the generated HTML/PDF/DOCX from `/resources`.

Run:

```bash
pnpm -C mcp install
pnpm -C mcp start
```

Endpoints:

- Streamable HTTP (recommended): `POST/GET/DELETE /mcp`
- Legacy HTTP+SSE: `GET /sse` and `POST /messages?sessionId=...`
- Resources (static files): `GET /resources/*`

Tools:

- `markdown_to_html` / `markdown_to_pdf` / `markdown_to_docx` - Convert Markdown to HTML/PDF/DOCX
- `markdown_convert` - Auto convert via `md2x.convert()` (front matter supported)
- `resources_upload` - Upload a file to `/resources` (e.g. images referenced by Markdown)

Notes:

- The conversion tools return an MCP `resource_link` pointing to the generated file URL.
- Config: `PORT` (default `3000`) and `MD2X_BASE_URL` (used to build the public `/resources` URL). See `mcp/README.md`.

## Puppeteer / Chrome install

This package depends on `puppeteer`. On first install, Puppeteer downloads a compatible "Chrome for Testing" build (cached under your user directory). Set `PUPPETEER_SKIP_DOWNLOAD=1` to skip download and use a system Chrome via `PUPPETEER_EXECUTABLE_PATH`.

## Open Source License

This project is open source under ISC license. Welcome to Star, report issues, suggest features, and contribute code.

**Project URL:** https://github.com/LarchLiu/md2x

## Acknowledgements

- [markdown-viewer-extension](https://github.com/xicilion/markdown-viewer-extension) - Developed based on this project

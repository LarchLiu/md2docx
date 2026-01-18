# md2x

Markdown → PDF/DOCX/HTML/Image converter (local, no server). Supports Mermaid/Graphviz/Infographic/Vega/HTML/SVG rendering, math, and code highlighting.

[![npm version](https://img.shields.io/npm/v/md2x.svg?style=flat-square)](https://www.npmjs.com/package/md2x)

## CLI Options

| Option | Alias | Description | Default | Values |
|--------|-------|-------------|---------|--------|
| `--help` | `-h` | Show help message | - | - |
| `--version` | `-v` | Show version number | - | - |
| `--output` | `-o` | Output file path | Input name with format extension | File path |
| `--format` | `-f` | Output format | `pdf` | `pdf`, `docx`, `html`, `png`, `jpg/jpeg`, `webp` |
| `--theme` | `-t` | Theme name | `default` | See `--list-themes` |
| `--diagram-mode` | - | HTML/Image diagram rendering mode | `live` | `img`, `live`, `none` |
| `--hr-page-break` | - | Convert horizontal rules to page breaks | `true` for PDF/DOCX, `false` for HTML/Image | `true`, `false` |
| `--list-themes` | - | List all available themes | - | - |

### Diagram Modes (HTML/Image)

- **`live`** (default): Render diagrams in the browser on load using online CDN scripts (Mermaid, @viz-js/viz, Vega-Lite, Infographic)
- **`img`**: Pre-render diagrams as embedded images (offline, stable; no CDN)
- **`none`**: Keep diagram source blocks only (no rendering)

## Front Matter Options

When converting a markdown **file**, you can put options in YAML front matter (the CLI merges front matter with CLI flags; explicit CLI flags win).

### Common (All Formats)

```yaml
---
format: pdf        # pdf | docx | html | png | jpg | jpeg | webp
theme: default
hrAsPageBreak: true
---
```

### PDF

```yaml
---
format: pdf
title: "My Doc"     # used for PDF metadata/header templates
pdf:
  format: A4        # A4 | Letter | Legal | A3 | A5
  landscape: false
  margin:
    top: 1cm
    bottom: 1cm
    left: 1cm
    right: 1cm
  printBackground: true
  scale: 1
  displayHeaderFooter: false
  headerTemplate: "<div style='font-size:10px;width:100%;text-align:center;'><span class='title'></span></div>"
  footerTemplate: "<div style='font-size:10px;width:100%;text-align:center;'>Page <span class='pageNumber'></span> / <span class='totalPages'></span></div>"
---
```

### DOCX

```yaml
---
format: docx
theme: default
hrAsPageBreak: true
---
```

### HTML

```yaml
---
format: html
title: "My Doc"
standalone: true    # full HTML document (default)
baseTag: true       # emit <base href="file://.../"> for resolving relative paths (default)
diagramMode: live   # img | live | none
cdn:                # optional: override CDN URLs (used when diagramMode: live)
  mermaid: "https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.min.js"
---
```

### Image (PNG/JPEG/WebP)

```yaml
---
format: png
diagramMode: live   # or "img" for offline (no CDN)
image:
  # selector can be a string or an array of selectors (CSS selector list).
  selector:
    - 'div.md2x-diagram[data-md2x-diagram-kind="mermaid"]'
    - 'div.md2x-diagram[data-md2x-diagram-kind="infographic"]'
  # selectorMode: first | each | union | stitch (default: stitch)
  # - union: capture the union bounding box (includes in-between page content)
  # - stitch: stack matched elements and capture only them (no in-between content)
  selectorMode: stitch
  selectorGap: 16      # optional: vertical gap (px) between stitched elements
  selectorPadding: 8   # optional: padding (px) around the stitched region
  split: auto          # optional: split very tall output into multiple images
---
```

When `image.split` produces multiple parts, outputs are written as `output.part-001.png`, `output.part-002.png`, ...

Diagram blocks are tagged with `data-md2x-diagram-kind` so you can target specific types via selectors:

```yaml
image:
  selector: 'div.md2x-diagram[data-md2x-diagram-kind="mermaid"]'
  selectorMode: stitch
```

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

Export to PNG:

```bash
npx md2x input.md -f png -o output.png
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
- `markdown_to_image` - Convert Markdown to an image (`png`/`jpg`/`jpeg`/`webp`), may return multiple parts for very tall pages
- `markdown_convert` - Auto convert via `md2x.convert()` (front matter supported; includes image formats)
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

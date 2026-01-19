# md2x

Markdown → PDF/DOCX/HTML/Image converter (local, no server). Supports Mermaid/Graphviz/Infographic/Vega/Template(vue/svelte/html) rendering, math, and code highlighting.

> Supports MCP tools and md2x skill. 🎉

[![npm version](https://img.shields.io/npm/v/md2x.svg?style=flat-square)](https://www.npmjs.com/package/md2x)

## CLI Usage

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
| `--templates-dir` | - | Extra template dir for md2x blocks (repeatable; resolved against input dir when relative) | - | Directory path |
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
  # Template blocks:
  vue: "https://unpkg.com/vue@3/dist/vue.global.js"
  vueSfcLoader: "https://cdn.jsdelivr.net/npm/vue3-sfc-loader/dist/vue3-sfc-loader.js"
  svelteCompiler: "https://esm.sh/svelte@5/compiler"
  svelteBase: "https://esm.sh/svelte@5/"
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

## md2x Template Blocks

Besides diagram blocks (mermaid/dot/vega-lite/infographic), `md2x` also supports template blocks via:

````md
```md2x
{
  type: 'vue',          // "vue" | "html" | "svelte"
  template: 'example.vue', // or "example.html" / "example.svelte"
  data: [{ title: 't', message: 'm' }]
}
```
````

```
//example.vue
<script setup>
const data = templateData;
</script>

<template>
<div class="my-component">Hello md2x! This is vue template</div>
<div v-for="(item, index) in data" :key="index">
  <h2>{{ item.title }}</h2>
  <p>{{ item.message }}</p>
</div>
</template>

<style scoped>
.my-component {
  color: red;
}
</style>
```

```svelte
<!-- example.svelte (Svelte 5) -->
<script>
  const data = templateData;
</script>

<div class="my-component">Hello md2x! This is svelte template</div>
{#each data as item, index}
  <div>
    <h2>{item.title}</h2>
    <p>{item.message}</p>
  </div>
{/each}

<style>
  .my-component { color: red; }
</style>
```

### Config Fields

- `type`: `"vue"`, `"html"`, or `"svelte"` (Svelte 5)
- `template`: template file name/path
  - if you only pass a filename (e.g. `example.vue`), it is treated as `${type}/${template}` (e.g. `vue/example.vue`)
- `data`: arbitrary JSON-serializable data (injected by replacing the `templateData` placeholder)
- `allowScripts` (optional, **unsafe**, html only): when exporting **images** in `diagramMode: "img"`, set `allowScripts: true` to execute inline `<script>` blocks before rendering to PNG.
  - not supported: `<script type="module">`
  - external `<script src="...">` is not supported for image rendering (use inline scripts)

### Svelte Notes (Svelte 5 + esm.sh)

- Svelte templates are compiled at runtime using the Svelte compiler, loaded from **esm.sh** via `import()`.
- This means Svelte template rendering requires network access (even in `diagramMode: "img"`), unless you override `cdn.svelteCompiler`/`cdn.svelteBase` to another ESM CDN that works in your environment.
- Templates are expected to be self-contained `.svelte` files (no preprocessors like TypeScript/Sass, and avoid local relative imports unless you provide an ESM-resolvable URL).

### Template Resolution (External Templates)

To load templates from outside the built-in `dist/templates`, use either:

- CLI: `--templates-dir /path/to/templates` (repeatable)
- Front matter: `templatesDir: /path/to/templates` (string or list)

### CDN Overrides (Live Mode)

When exporting **HTML/Image** with `diagramMode: live`, you can override CDN URLs in front matter:

```yaml
cdn:
  vue: "https://unpkg.com/vue@3/dist/vue.global.js"
  vueSfcLoader: "https://cdn.jsdelivr.net/npm/vue3-sfc-loader/dist/vue3-sfc-loader.js"
  svelteCompiler: "https://esm.sh/svelte@5/compiler"
  svelteBase: "https://esm.sh/svelte@5/"
```

## md2x Skill

This repo also includes a skill for driving `md2x` from an agent:

- Skill: `skills/md2x/SKILL.md`
- What it does: guides an agent to run `npx md2x ...`, pick formats/themes, and use front matter correctly.
- Install (example):

```bash
npx skills add larchliu/md2x

or

npx add-skill larchliu/md2x
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

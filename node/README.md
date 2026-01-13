# md2x

Markdown → PDF/DOCX converter (local, no server). Supports Mermaid/Graphviz/Vega/HTML/SVG rendering, math, and code highlighting.

## Usage

```bash
npx md2x input.md
```

Export to DOCX:

```bash
npx md2x input.md -f docx
```

List themes:

```bash
npx md2x --list-themes
```

Use a theme:

```bash
npx md2x input.md -o output.pdf --theme academic
```

## Dev (this repo)

```bash
npm run node:dev -- ./demo/test.md
```

## Puppeteer / Chrome install

This package depends on `puppeteer`. On first install, Puppeteer downloads a compatible "Chrome for Testing" build (cached under your user directory). Set `PUPPETEER_SKIP_DOWNLOAD=1` to skip download and use a system Chrome via `PUPPETEER_EXECUTABLE_PATH`.

## Publish (maintainers)

```bash
npm publish
```

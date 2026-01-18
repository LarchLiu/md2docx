# md2x MCP server (Express)

This folder contains an MCP (Model Context Protocol) server that exposes `md2x` capabilities (Markdown -> HTML/PDF/DOCX/images) over HTTP.

## Run

```bash
pnpm -C mcp install
pnpm -C mcp start
```

By default it listens on `http://localhost:3000` (or whatever `PORT` is set to in `mcp/.env`).

## Endpoints

- Streamable HTTP (recommended): `POST/GET/DELETE /mcp`
- Legacy HTTP+SSE: `GET /sse` and `POST /messages?sessionId=...`
- Resources (static files): `GET /resources/*`

## Tools (MCP)

Conversion tools return an MCP `resource_link` pointing to a generated file URL under `/resources`.

- `markdown_to_html` - Convert markdown to HTML
- `markdown_to_pdf` - Convert markdown to PDF
- `markdown_to_docx` - Convert markdown to DOCX
- `markdown_to_image` - Convert markdown to an image (png/jpg/jpeg/webp), may return multiple parts for very tall pages
- `markdown_convert` - Auto convert via `md2x.convert()` (front matter supported; includes image formats)
- `resources_upload` - Upload a file to `/resources` (base64 content) and get back a URL

## Environment Variables

Create a `.env` file in the `mcp` directory:

```env
PORT=3001
MD2X_BASE_URL=http://localhost:3001
```

- `PORT` - Server port (default: `3000`)
- `MD2X_BASE_URL` - Base URL used to build the public `/resources` download URL (optional, auto-generated from `PORT` if not set)

import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import pkg from "../package.json" with { type: "json" };

import {
  convert,
} from "md2x";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES_PATH = "resources";
const HTML_PATH = "html";

const pdfOptionsSchema = z.object({
  format: z.enum(["A4", "Letter", "Legal", "A3", "A5"]).optional(),
  landscape: z.boolean().optional(),
  margin: z.object({
    top: z.union([z.string(), z.number()]).optional(),
    bottom: z.union([z.string(), z.number()]).optional(),
    left: z.union([z.string(), z.number()]).optional(),
    right: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  printBackground: z.boolean().optional(),
  scale: z.number().optional(),
  displayHeaderFooter: z.boolean().optional(),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  title: z.string().optional(),
}).optional();

function getBasePath() {
  // Resolve relative to mcp directory (parent of src)
  const resolved = resolve(__dirname, "..", RESOURCES_PATH);
  // Ensure directory exists
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function getResourcesBaseUrl() {
  return `${getServerBaseUrl()}/${RESOURCES_PATH}`;
}

function getServerBaseUrl() {
  const port = process.env.PORT || 3000;
  return process.env.MD2X_BASE_URL || `http://localhost:${port}`;
}

function getMimeTypeForFormat(format) {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

async function executeConvert(options, format) {
  const basePath = getBasePath();
  const result = await convert(options.markdown, {
    ...options,
    basePath,
    format,
  });

  const actualFormat = result.format ?? format;
  const content = []
  const buf = result.buffer ?? result;
  const bufs = result.buffers ?? null;
  const mimeType = getMimeTypeForFormat(actualFormat);
  const filename = `md2x-output-${randomUUID()}.${actualFormat}`;
  const fullPath = resolve(basePath, filename);
  await writeFile(fullPath, buf);
  const url = `${getResourcesBaseUrl()}/${filename}`;
  content.push({
    type: "resource_link",
    uri: url,
    name: filename,
    mimeType: mimeType,
    annotations: {
      audience: ["user"],
      priority: 1.0,
      lastModified: new Date().toISOString(),
    },
  });

  if (bufs && Array.isArray(bufs) && bufs.length > 1) {
    for (let i = 0; i < bufs.length; i++) {
      const partFilename = `md2x-output-${randomUUID()}-part${i + 1}.${actualFormat}`;
      const partFullPath = resolve(basePath, partFilename);
      await writeFile(partFullPath, bufs[i]);
      const partUrl = `${getResourcesBaseUrl()}/${partFilename}`;
      content.push({
        type: "resource_link",
        uri: partUrl,
        name: partFilename,
        mimeType: mimeType,
        annotations: {
          audience: ["user"],
          priority: 1.0,
          lastModified: new Date().toISOString(),
        },
      });
    }
  }

  return {
    content,
  };
}

async function executeConvertWithHosted(options, format, hosted = false) {
  const data = await executeConvert(options, format);
  if (hosted) {
    const fromSegment = `/${RESOURCES_PATH}/`;
    const toSegment = `/${HTML_PATH}/`;
    data.content = data.content.map((item) => {
      if (item.type === "resource_link" && item.mimeType === "text/html") {
        // TODO: Persist data, or schedule resource cleanup.
        try {
          const u = new URL(item.uri);
          if (u.pathname.startsWith(fromSegment)) {
            u.pathname = `${toSegment}${u.pathname.slice(fromSegment.length)}`;
            return { ...item, uri: u.toString() };
          }
        } catch {
          // Ignore and fallback to string handling.
        }

        if (typeof item.uri === "string" && item.uri.includes(fromSegment)) {
          return { ...item, uri: item.uri.replace(fromSegment, toSegment) };
        }
      }
      return item;
    });
  }
  return data;
}

function createMcpServer() {
  const server = new McpServer({
    name: "md2x-mcp",
    version: pkg.version,
  });

  server.registerTool(
    "markdown_to_html",
    {
      description: "Convert markdown to an HTML. If convert succeeds, returns the file path URL.",
      inputSchema: {
        markdown: z.string(),
        theme: z.string().optional(),
        title: z.string().optional(),
        diagramMode: z.enum(["img", "live", "none"]).optional(),
        standalone: z.boolean().optional(),
        baseTag: z.boolean().optional(),
        hrAsPageBreak: z.boolean().optional(),
        hosted: z.boolean().optional(),
      },
    },
    async (args) => executeConvertWithHosted({
      markdown: args.markdown,
      theme: args.theme ?? "default",
      title: args.title ?? "Document",
      diagramMode: args.diagramMode ?? "live",
      standalone: args.standalone,
      baseTag: args.baseTag,
      hrAsPageBreak: args.hrAsPageBreak,
    }, "html", args.hosted ?? false)
  );

  server.registerTool(
    "markdown_to_pdf",
    {
      description:
        "Convert markdown to PDF. If convert succeeds, returns the file path URL.",
      inputSchema: {
        markdown: z.string(),
        theme: z.string().optional(),
        title: z.string().optional(),
        hrAsPageBreak: z.boolean().optional(),
        pdf: pdfOptionsSchema,
      },
    },
    async (args) => executeConvert({
      markdown: args.markdown,
      theme: args.theme ?? "default",
      hrAsPageBreak: args.hrAsPageBreak ?? true,
      pdf: {
        ...(args.pdf ?? {}),
        title: args.title ?? "Document",
      },
    }, "pdf")
  );

  server.registerTool(
    "markdown_to_docx",
    {
      description: "Convert markdown to DOCX. If convert succeeds, returns the file path URL.",
      inputSchema: {
        markdown: z.string(),
        theme: z.string().optional(),
        hrAsPageBreak: z.boolean().optional(),
      },
    },
    async (args) => executeConvert({
      markdown: args.markdown,
      theme: args.theme ?? "default",
      hrAsPageBreak: args.hrAsPageBreak ?? true,
    }, "docx")
  );

  server.registerTool(
    "markdown_to_image",
    {
      description:
        "Convert markdown to an image (png/jpg/jpeg/webp). If convert succeeds, returns the file path URL(s). Very tall pages may produce multiple parts.",
      inputSchema: {
        markdown: z.string(),
        format: z.enum(["png", "jpg", "jpeg", "webp"]).optional(),
        theme: z.string().optional(),
        hrAsPageBreak: z.boolean().optional(),
      },
    },
    async (args) => executeConvert({
      markdown: args.markdown,
      theme: args.theme ?? "default",
      // For image output, default to "false" (align with md2x Node host defaults).
      hrAsPageBreak: args.hrAsPageBreak ?? false,
    }, args.format ?? "png")
  );

  server.registerTool(
    "markdown_convert",
    {
      description:
        "Auto convert via md2x.convert() (front matter supported). If convert succeeds, returns the file path URL.",
      inputSchema: {
        markdown: z.string(),
        // When present, overrides any front matter format.
        format: z.enum(["pdf", "docx", "html", "png", "jpg", "jpeg", "webp"]).optional(),
        theme: z.string().optional(),
        title: z.string().optional(),
        diagramMode: z.enum(["img", "live", "none"]).optional(),
        standalone: z.boolean().optional(),
        baseTag: z.boolean().optional(),
        hrAsPageBreak: z.boolean().optional(),
        pdf: pdfOptionsSchema,
        hosted: z.boolean().optional(),
      },
    },
    async (args) => executeConvertWithHosted({
      markdown: args.markdown,
      format: args.format,
      theme: args.theme,
      title: args.title,
      diagramMode: args.diagramMode,
      standalone: args.standalone,
      baseTag: args.baseTag,
      hrAsPageBreak: args.hrAsPageBreak,
      pdf: args.pdf,
    }, args.format, args.hosted ?? false)
  );

  server.registerTool(
    "resources_upload",
    {
      description: "Upload a file to the resources directory. Returns the URL of the uploaded file.",
      inputSchema: {
        path: z.string().describe("Target path/filename for the uploaded file (e.g., 'images/photo.png')"),
        content: z.string().describe("Base64 encoded file content"),
      },
    },
    async (args) => {
      const basePath = getBasePath();
      const safePath = basename(args.path);
      const fullPath = resolve(basePath, safePath);

      const buffer = Buffer.from(args.content, "base64");
      await writeFile(fullPath, buffer);

      const url = `${getResourcesBaseUrl()}/${safePath}`;
      return {
        content: [{ type: "text", text: JSON.stringify({ path: safePath, url }) }],
      };
    }
  );

  server.registerResource(
    "md2x-info",
    "md2x://info",
    { description: "Information about the md2x MCP server." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            {
              name: "md2x-mcp",
              tools: [
                "markdown_to_html",
                "markdown_to_pdf",
                "markdown_to_docx",
                "markdown_to_image",
                "markdown_convert",
                "resources_upload",
              ],
              endpoints: {
                streamableHttp: "/mcp",
                sse: "/sse",
                sseMessages: "/messages?sessionId=...",
              },
            },
            null,
            2
          ),
        },
      ],
    })
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "25mb" }));

// Static file server for resources
app.use(`/${RESOURCES_PATH}`, express.static(getBasePath()));

// HTML page access: /html/<file>.html (served from the same resources directory)
// Only allow ".html" via this route to avoid exposing other resource types through /html.
app.use(
  `/${HTML_PATH}`,
  (req, res, next) => {
    if (!req.path.toLowerCase().endsWith(".html")) {
      res.status(404).send("Not Found");
      return;
    }
    // Hint browsers to render as a page when possible.
    res.setHeader("Content-Disposition", "inline");
    next();
  },
  express.static(getBasePath())
);

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport (recommended)
// ---------------------------------------------------------------------------
const streamableSessions = new Map();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  // eslint-disable-next-line no-console
  console.log("[MCP] POST /mcp", {
    sessionId,
    method: req.body?.method,
    hasSession: streamableSessions.has(sessionId),
  });

  /** @type {import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport} */
  let transport;

  if (typeof sessionId === "string" && streamableSessions.has(sessionId)) {
    transport = streamableSessions.get(sessionId).transport;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // Create a new MCP server instance per session.
    const server = createMcpServer();

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableSessions.set(sid, { transport, server });
      },
    });

    transport.onclose = () => {
      if (typeof transport.sessionId === "string") {
        const entry = streamableSessions.get(transport.sessionId);
        streamableSessions.delete(transport.sessionId);
        try {
          entry?.server?.close?.();
        } catch {
          // best-effort cleanup
        }
      }
    };

    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    // Best-effort error response (avoid "headers already sent" issues).
    // eslint-disable-next-line no-console
    console.error("Error handling MCP /mcp request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

async function handleStreamableSessionRequest(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId !== "string" || !streamableSessions.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const { transport } = streamableSessions.get(sessionId);
  await transport.handleRequest(req, res);
}

app.get("/mcp", handleStreamableSessionRequest);
app.delete("/mcp", handleStreamableSessionRequest);

// ---------------------------------------------------------------------------
// Legacy HTTP+SSE transport (for older clients)
// ---------------------------------------------------------------------------
const sseSessions = new Map();

app.get("/sse", async (_req, res) => {
  const server = createMcpServer();
  const transport = new SSEServerTransport("/messages", res);

  sseSessions.set(transport.sessionId, { transport, server });

  res.on("close", () => {
    sseSessions.delete(transport.sessionId);
    try {
      transport.close();
    } catch {
      // best-effort cleanup
    }
    try {
      server.close();
    } catch {
      // best-effort cleanup
    }
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== "string") {
    res.status(400).send("Missing sessionId");
    return;
  }

  const entry = sseSessions.get(sessionId);
  if (!entry) {
    res.status(400).send("No transport found for sessionId");
    return;
  }

  await entry.transport.handlePostMessage(req, res, req.body);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`md2x MCP server listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`- Streamable HTTP: POST/GET/DELETE http://localhost:${port}/mcp`);
  // eslint-disable-next-line no-console
  console.log(`- SSE (legacy):    GET http://localhost:${port}/sse`);
  // eslint-disable-next-line no-console
  console.log(`- Resources:       http://localhost:${port}/${RESOURCES_PATH}`);
});

# md2x Node/CLI Conversion Flow (by format)

This diagram summarizes the current Node/CLI pipeline (`node/src/host/cli.ts` -> `node/src/host/index.ts` -> exporters in `node/src/host/node-exporter.ts`)
and how it branches by `format`.

```mermaid
flowchart TD
  classDef spacer fill:transparent,stroke:transparent,color:transparent;

  %% =========================
  %% CLI entry + option merge
  %% =========================
  start["CLI: npx md2x input.md"] --> parseArgs["Parse CLI args - node_src_host_cli.ts"]
  parseArgs --> readFile[Read input.md]
  readFile --> parseFM["parseFrontMatter - node_src_host_index.ts"]
  parseFM --> mergeOpts["Merge options - explicit CLI overrides front matter overrides defaults"]
  mergeOpts --> callConvert["convert - node_src_host_index.ts"]
  callConvert --> chooseFmt{format?}

  chooseFmt -->|pdf| pdfEntry["PDF: NodePdfExporter.exportToBuffer"]
  chooseFmt -->|docx| docxEntry["DOCX: NodeDocxExporter.exportToBuffer"]
  chooseFmt -->|html| htmlEntry["HTML: NodeHtmlExporter.exportToString or exportToBuffer"]
  chooseFmt -->|png or jpg or jpeg or webp| imgEntry["Image: NodeImageExporter.exportToBuffer or exportToBuffers"]

  writeOut["Write output files"] --> done["Done"]

  %% ==========
  %% PDF flow
  %% ==========
  subgraph pdf["PDF - Puppeteer print to PDF"]
    pdf1[Load theme config]
    pdf2["Create BrowserRenderer - Puppeteer"]
    pdf3["markdownToHtmlFragment + processDiagrams - diagramMode: img live none"]
    pdf4{diagramMode == live?}
    pdf5["Append live bootstrap - wait window.__md2xLiveDone"]
    pdf6["Load CSS - KaTeX + base + theme"]
    pdf7["exportToPdf via Puppeteer"]
    pdf1 --> pdf2 --> pdf3 --> pdf4
    pdf4 -->|yes| pdf5 --> pdf6 --> pdf7
    pdf4 -->|no| pdf6 --> pdf7
  end
  pdfEntry --> pdf1
  pdf7 --> writeOut

  %% ===========
  %% DOCX flow
  %% ===========
  subgraph docx["DOCX - DocxExporter + plugin renderer"]
    docx1["Create node platform - capture DOCX buffer"]
    docx2["Create BrowserRenderer - Puppeteer - when docx needs images"]
    docx3["createPluginRenderer - plugin system calls renderer.render(type, code)"]
    docx4["DocxExporter.exportToDocx"]
    docxKind{block kind?}
    docxText["Render text and tables"]
    docxDiagram["Render diagram to image - BrowserRenderer"]
    docxMd2x["Render md2x template to image - BrowserRenderer md2x"]
    docxInsert["Insert image into docx"]
    docxFinalize["Finalize DOCX document"]
    docx5["Get captured buffer - platform output"]
    docx1 --> docx2 --> docx3 --> docx4 --> docxKind
    docxKind -->|text| docxText --> docxFinalize
    docxKind -->|diagram| docxDiagram --> docxInsert --> docxFinalize
    docxKind -->|md2x| docxMd2x --> docxInsert
    docxFinalize --> docx5
  end
  docxEntry --> docx1
  docx5 --> writeOut

  %% ===========
  %% HTML flow
  %% ===========
  subgraph html["HTML - standalone document by default"]
    html1[Load theme config]
    html2{diagramMode == img?}
    html3["Create BrowserRenderer - Puppeteer - only when diagramMode == img"]
    html4["markdownToHtmlFragment - img: pre-render diagrams; live none: keep blocks"]
    html5{standalone?}
    html6["Wrap as full HTML - inline CSS + optional base tag + if live append bootstrap"]
    html7["Return HTML string or buffer"]
    html1 --> html2
    html2 -->|yes| html3 --> html4
    html2 -->|no| html4
    html4 --> html5
    html5 -->|yes| html6 --> html7
    html5 -->|no| html7
  end
  htmlEntry --> html1
  html7 --> writeOut

  %% =============
  %% Image flow
  %% =============
  subgraph image["Image - png jpg jpeg webp"]
    img1[Load theme config]
    img2["Create BrowserRenderer - Puppeteer"]
    img3["markdownToHtmlFragment + processDiagrams - diagramMode: img live none"]
    img4{diagramMode == live?}
    img5["Append live bootstrap - wait window.__md2xLiveDone"]
    img6["Load CSS - KaTeX + base + theme"]
    img7["exportToImageParts - Puppeteer screenshot + split very tall pages"]
    img1 --> img2 --> img3 --> img4
    img4 -->|yes| img5 --> img6 --> img7
    img4 -->|no| img6 --> img7
  end
  imgEntry --> img1
  img7 --> writeOut

  %% ===========================
  %% Notes on diagram rendering
  %% ===========================
  note1["diagramMode = img: processDiagrams replaces code blocks with image elements via BrowserRenderer.render; md2x uses DOM mount + element screenshot for canvas WebGL"]
  pdf3 -.-> note1
  img3 -.-> note1
```

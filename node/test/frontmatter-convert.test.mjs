import fs from 'node:fs';
import path from 'node:path';
import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import {
  loadApi,
  demoDir,
  fmPdfPath,
  fmPdfLetterPath,
  fmPdfA5Path,
  fmPdfCustomPath,
  fmHtmlPath,
  fmHtmlFragmentPath,
  fmHtmlThemePath,
  fmDocxPath,
  fmDiagramNonePath,
} from './setup.mjs';

let api;

before(async () => {
  api = await loadApi();
});

describe('convert with front matter', () => {
  test('uses PDF format from front matter', async () => {
    const content = fs.readFileSync(fmPdfPath, 'utf8');
    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'pdf');
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 0);
  });

  test('uses HTML format from front matter', async () => {
    const content = fs.readFileSync(fmHtmlPath, 'utf8');
    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'html');
    const html = buffer.toString('utf8');
    assert.ok(html.includes('<title>Custom HTML Title</title>'));
  });

  test('uses DOCX format from front matter', async () => {
    const content = fs.readFileSync(fmDocxPath, 'utf8');
    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'docx');
    assert.ok(buffer instanceof Buffer);
    assert.ok(buffer.length > 0);
  });

  test('options override front matter', async () => {
    const content = fs.readFileSync(fmPdfPath, 'utf8');
    const { format } = await api.convert(content, { format: 'html' });
    assert.strictEqual(format, 'html');
  });

  test('diagramMode: none keeps mermaid code blocks', async () => {
    const content = fs.readFileSync(fmDiagramNonePath, 'utf8');
    const { buffer } = await api.convert(content);
    const html = buffer.toString('utf8');
    assert.ok(html.includes('language-mermaid'));
  });
});

describe('convertFile with front matter', () => {
  test('uses format from front matter', async () => {
    const outputPath = path.join(demoDir, 'test-frontmatter-pdf.pdf');
    const result = await api.convertFile(fmPdfPath, outputPath);
    assert.strictEqual(result.format, 'pdf');
    assert.ok(fs.existsSync(outputPath));
    assert.ok(result.buffer.length > 0);
  });
});

// =============================================================================
// PDF Options Tests
// =============================================================================
describe('PDF options from front matter', () => {
  test('PDF with A4 format and margins', async () => {
    const content = fs.readFileSync(fmPdfPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    const options = api.frontMatterToOptions(parsed.data);

    assert.strictEqual(options.pdf?.format, 'A4');
    assert.strictEqual(options.pdf?.margin?.top, '25mm');
    assert.strictEqual(options.pdf?.margin?.bottom, '25mm');
    assert.strictEqual(options.pdf?.margin?.left, '15mm');
    assert.strictEqual(options.pdf?.margin?.right, '15mm');
    assert.strictEqual(options.pdf?.displayHeaderFooter, true);
    assert.ok(options.pdf?.headerTemplate?.includes('class="title"'));
    assert.ok(options.pdf?.footerTemplate?.includes('class="pageNumber"'));

    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'pdf');
    assert.ok(buffer.length > 0);
  });

  test('PDF with Letter format and landscape', async () => {
    const content = fs.readFileSync(fmPdfLetterPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    const options = api.frontMatterToOptions(parsed.data);

    assert.strictEqual(options.pdf?.format, 'Letter');
    assert.strictEqual(options.pdf?.landscape, true);
    assert.strictEqual(options.pdf?.margin?.top, '10mm');

    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'pdf');
    assert.ok(buffer.length > 0);
  });

  test('PDF with A5 format and scale', async () => {
    const content = fs.readFileSync(fmPdfA5Path, 'utf8');
    const parsed = api.parseFrontMatter(content);
    const options = api.frontMatterToOptions(parsed.data);

    assert.strictEqual(options.pdf?.format, 'A5');
    assert.strictEqual(options.pdf?.scale, 0.9);
    assert.strictEqual(options.pdf?.printBackground, true);
    assert.strictEqual(options.pdf?.margin?.top, '5mm');

    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'pdf');
    assert.ok(buffer.length > 0);
  });

  test('PDF with custom width and height', async () => {
    const content = fs.readFileSync(fmPdfCustomPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    const options = api.frontMatterToOptions(parsed.data);

    assert.strictEqual(options.pdf?.width, '800px');
    assert.strictEqual(options.pdf?.height, '600px');
    assert.strictEqual(options.pdf?.margin?.top, 0);

    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'pdf');
    assert.ok(buffer.length > 0);
  });

  test('convertFile with Letter landscape PDF', async () => {
    const outputPath = path.join(demoDir, 'test-frontmatter-pdf-letter.pdf');
    const result = await api.convertFile(fmPdfLetterPath, outputPath);
    assert.strictEqual(result.format, 'pdf');
    assert.ok(fs.existsSync(outputPath));
    assert.ok(result.buffer.length > 0);
  });

  test('convertFile with A5 PDF', async () => {
    const outputPath = path.join(demoDir, 'test-frontmatter-pdf-a5.pdf');
    const result = await api.convertFile(fmPdfA5Path, outputPath);
    assert.strictEqual(result.format, 'pdf');
    assert.ok(fs.existsSync(outputPath));
    assert.ok(result.buffer.length > 0);
  });

  test('convertFile with custom size PDF', async () => {
    const outputPath = path.join(demoDir, 'test-frontmatter-pdf-custom.pdf');
    const result = await api.convertFile(fmPdfCustomPath, outputPath);
    assert.strictEqual(result.format, 'pdf');
    assert.ok(fs.existsSync(outputPath));
    assert.ok(result.buffer.length > 0);
  });
});

// =============================================================================
// HTML Options Tests
// =============================================================================
describe('HTML options from front matter', () => {
  test('HTML with standalone: false returns fragment only', async () => {
    const content = fs.readFileSync(fmHtmlFragmentPath, 'utf8');
    const parsed = api.parseFrontMatter(content);
    const options = api.frontMatterToOptions(parsed.data);

    // Verify options are parsed correctly
    assert.strictEqual(options.format, 'html');
    assert.strictEqual(options.theme, 'rainbow');
    assert.strictEqual(options.standalone, false);
    assert.strictEqual(options.baseTag, false);

    // Convert and verify output
    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'html');

    const html = buffer.toString('utf8');

    // Fragment should NOT contain full document structure
    assert.ok(!html.includes('<!DOCTYPE html>'), 'Fragment should not have DOCTYPE');
    assert.ok(!html.includes('<html'), 'Fragment should not have <html> tag');
    assert.ok(!html.includes('<head>'), 'Fragment should not have <head> tag');
    assert.ok(!html.includes('<body>'), 'Fragment should not have <body> tag');
    assert.ok(!html.includes('<base'), 'Fragment should not have <base> tag');

    // Fragment should contain the converted content
    assert.ok(html.includes('<h1>'), 'Fragment should contain heading');
    assert.ok(html.includes('HTML Fragment Test'), 'Fragment should contain title text');
    assert.ok(html.includes('<strong>bold</strong>'), 'Fragment should contain bold text');
    assert.ok(html.includes('<em>italic</em>'), 'Fragment should contain italic text');
  });

  test('HTML with standalone: true (default) returns full document', async () => {
    const content = fs.readFileSync(fmHtmlPath, 'utf8');
    const { buffer, format } = await api.convert(content);
    assert.strictEqual(format, 'html');

    const html = buffer.toString('utf8');

    // Full document should contain document structure
    assert.ok(html.includes('<!DOCTYPE html>'), 'Full doc should have DOCTYPE');
    assert.ok(html.includes('<html'), 'Full doc should have <html> tag');
    assert.ok(html.includes('<head>'), 'Full doc should have <head> tag');
    assert.ok(html.includes('<body>'), 'Full doc should have <body> tag');
    assert.ok(html.includes('<style>'), 'Full doc should have embedded styles');
  });

  test('HTML with baseTag: false omits base tag', async () => {
    const content = fs.readFileSync(fmHtmlFragmentPath, 'utf8');
    // Override standalone to true to get full document, but baseTag should still be false
    const { buffer } = await api.convert(content, { standalone: true });
    const html = buffer.toString('utf8');

    // Should have full document but no base tag
    assert.ok(html.includes('<!DOCTYPE html>'), 'Should have DOCTYPE');
    assert.ok(!html.includes('<base'), 'Should not have <base> tag when baseTag: false');
  });

  test('convertFile with HTML theme', async () => {
    const outputPath = path.join(demoDir, 'test-frontmatter-html-theme.html');
    const result = await api.convertFile(fmHtmlThemePath, outputPath);
    assert.strictEqual(result.format, 'html');
    assert.ok(fs.existsSync(outputPath));

    const html = result.buffer.toString('utf8');
    // Full document output
    assert.ok(html.includes('<!DOCTYPE html>'), 'Full doc should have DOCTYPE');
  });
});

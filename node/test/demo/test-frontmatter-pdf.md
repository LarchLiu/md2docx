---
format: pdf
theme: default
hrAsPageBreak: true
pdf:
  format: A4
  margin:
    top: 25mm
    bottom: 25mm
    left: 15mm
    right: 15mm
  displayHeaderFooter: true
  headerTemplate: '<div style="font-size:10px;width:100%;text-align:center;color:#666;"><span class="title"></span></div>'
  footerTemplate: '<div style="font-size:10px;width:100%;text-align:center;color:#666;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
---

# Front Matter PDF Test

This document tests PDF-specific front matter options.

## Section 1

Some content in section 1.

---

## Section 2 (After Page Break)

This section should appear on a new page because `hrAsPageBreak: true`.

### Features Tested

- `format: pdf` - Output format
- `theme: default` - Theme selection
- `hrAsPageBreak: true` - HR as page break
- `pdf.format: A4` - PDF page format
- `pdf.margin` - PDF margins
- `pdf.displayHeaderFooter: true` - Enable header/footer
- `pdf.headerTemplate` - Custom header with title
- `pdf.footerTemplate` - Custom footer with page numbers

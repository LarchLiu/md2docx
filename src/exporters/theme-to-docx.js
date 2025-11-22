// Theme to DOCX Converter
// Converts theme configuration to DOCX styles

import themeManager from '../utils/theme-manager.js';
import { BorderStyle } from 'docx';

/**
 * Convert theme configuration to DOCX styles object
 * @param {Object} theme - Theme configuration object
 * @param {Object} tableStyle - Table style configuration
 * @param {Object} codeTheme - Code highlighting theme
 * @param {Object} spacingScheme - Spacing scheme configuration
 * @returns {Object} DOCX styles configuration
 */
export function themeToDOCXStyles(theme, tableStyle, codeTheme, spacingScheme) {
  const codeBackground = theme.fontScheme.code.background;
  return {
    default: generateDefaultStyle(theme.fontScheme, spacingScheme),
    paragraphStyles: generateParagraphStyles(theme.fontScheme, spacingScheme),
    characterStyles: generateCharacterStyles(theme.fontScheme),
    tableStyles: generateTableStyles(tableStyle),
    codeColors: generateCodeColors(codeTheme, codeBackground)
  };
}

/**
 * Generate default document style
 * @param {Object} fontScheme - Font scheme configuration
 * @param {Object} spacingScheme - Spacing scheme configuration (ratios relative to body font size)
 * @returns {Object} Default style configuration
 */
function generateDefaultStyle(fontScheme, spacingScheme) {
  const bodyFont = fontScheme.body.fontFamily;
  const fontSize = themeManager.ptToHalfPt(fontScheme.body.fontSize);
  const baseFontSizePt = parseFloat(fontScheme.body.fontSize);
  
  // Line spacing in DOCX: 240 = single spacing, 360 = 1.5 spacing, 480 = double spacing
  const lineSpacing = Math.round(fontScheme.body.lineHeight * 240);
  
  // Calculate the extra space added by line spacing (beyond 100%)
  // For example, if lineSpacing = 360 (1.5x), extra = 360 - 240 = 120
  const lineSpacingExtra = lineSpacing - 240;
  
  // Calculate actual spacing from ratio - split evenly between before and after
  const paragraphSpacingPt = baseFontSizePt * spacingScheme.paragraph;
  const halfSpacing = themeManager.ptToTwips((paragraphSpacingPt / 2) + 'pt');
  
  // Compensate for line spacing being applied to bottom
  // Split the extra line spacing evenly: before += extra/2, after -= extra/2
  const beforeSpacing = halfSpacing + lineSpacingExtra / 2;
  const afterSpacing = Math.max(0, halfSpacing - lineSpacingExtra / 2);
  
  // For DOCX: get font configuration from font-config.json
  const docxFont = themeManager.getDocxFont(bodyFont);

  return {
    run: {
      font: docxFont,
      size: fontSize
    },
    paragraph: {
      spacing: {
        line: lineSpacing,
        before: beforeSpacing,
        after: afterSpacing
      }
    }
  };
}

/**
 * Generate paragraph styles for headings
 * @param {Object} fontScheme - Font scheme configuration
 * @param {Object} spacingScheme - Spacing scheme configuration
 * @returns {Object} Paragraph styles
 */
function generateParagraphStyles(fontScheme, spacingScheme) {
  const styles = {};

  // Generate heading styles
  Object.keys(fontScheme.headings).forEach((level, index) => {
    const heading = fontScheme.headings[level];
    const headingLevel = index + 1; // h1 = 1, h2 = 2, etc.

    // Inherit font from body if not specified
    const font = heading.fontFamily || fontScheme.body.fontFamily;
    const docxFont = themeManager.getDocxFont(font);

    // Get heading's own spacing (before/after from theme), split evenly
    const headingBeforePt = heading.spacing?.before ? parseFloat(heading.spacing.before) : 0;
    const headingAfterPt = heading.spacing?.after ? parseFloat(heading.spacing.after) : 0;
    
    const halfBeforePt = headingBeforePt / 2;
    const halfAfterPt = headingAfterPt / 2;
    
    // Compensate for line spacing in before
    // Headings use 1.5x line spacing = 360, extra = 120
    const lineSpacingExtra = 360 - 240;
    
    const totalBefore = themeManager.ptToTwips(halfBeforePt + 'pt') + lineSpacingExtra / 2;
    const totalAfter = Math.max(0, themeManager.ptToTwips(halfAfterPt + 'pt') - lineSpacingExtra / 2);

    styles[`heading${headingLevel}`] = {
      id: `Heading${headingLevel}`,
      name: `Heading ${headingLevel}`,
      basedOn: 'Normal',
      next: 'Normal',
      run: {
        size: themeManager.ptToHalfPt(heading.fontSize),
        bold: heading.fontWeight === 'bold',
        font: docxFont
      },
      paragraph: {
        spacing: {
          before: totalBefore,
          after: totalAfter,
          line: 360 // 1.5 line spacing for headings
        },
        alignment: heading.alignment === 'center' ? 'center' : 'left'
      }
    };
  });

  return styles;
}

/**
 * Generate character styles (for inline elements)
 * @param {Object} fontScheme - Font scheme configuration
 * @returns {Object} Character styles
 */
function generateCharacterStyles(fontScheme) {
  const codeFont = fontScheme.code.fontFamily;
  const codeBackground = fontScheme.code.background.replace('#', ''); // Remove # for DOCX
  const docxFont = themeManager.getDocxFont(codeFont);

  return {
    code: {
      font: docxFont,
      size: themeManager.ptToHalfPt(fontScheme.code.fontSize),
      background: codeBackground
    }
  };
}

/**
 * Generate table styles for DOCX
 * @param {Object} tableStyle - Table style configuration
 * @returns {Object} Table style configuration
 */
function generateTableStyles(tableStyle) {
  const docxTableStyle = {
    borders: {},
    header: {},
    cell: {},
    zebra: tableStyle.zebra?.enabled || false,
    borderMode: tableStyle.borderMode || 'full-borders' // default to full borders
  };

  // Convert borders based on what's defined in the border object
  const border = tableStyle.border || {};
  
  // Initialize default borders
  const noBorder = { style: BorderStyle.NONE, size: 0, color: '000000' };
  docxTableStyle.borders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder,
    insideHorizontal: noBorder,
    insideVertical: noBorder
  };

  // If border.all is defined, apply to all borders
  if (border.all) {
    const borderConfig = {
      style: convertBorderStyle(border.all.style),
      size: parseBorderWidth(border.all.width, border.all.style),
      color: border.all.color.replace('#', '')
    };
    docxTableStyle.borders = {
      top: borderConfig,
      bottom: borderConfig,
      left: borderConfig,
      right: borderConfig,
      insideHorizontal: borderConfig,
      insideVertical: borderConfig
    };
  }
  
  // Override with specific borders if defined
  // These work for all borderModes: full-borders, horizontal-only, and no-borders
  if (border.headerTop) {
    docxTableStyle.borders.headerTop = {
      style: convertBorderStyle(border.headerTop.style),
      size: parseBorderWidth(border.headerTop.width, border.headerTop.style),
      color: border.headerTop.color.replace('#', '')
    };
  }
  if (border.headerBottom) {
    docxTableStyle.borders.headerBottom = {
      style: convertBorderStyle(border.headerBottom.style),
      size: parseBorderWidth(border.headerBottom.width, border.headerBottom.style),
      color: border.headerBottom.color.replace('#', '')
    };
  }
  if (border.rowBottom) {
    docxTableStyle.borders.insideHorizontal = {
      style: convertBorderStyle(border.rowBottom.style),
      size: parseBorderWidth(border.rowBottom.width, border.rowBottom.style),
      color: border.rowBottom.color.replace('#', '')
    };
  }
  if (border.lastRowBottom) {
    docxTableStyle.borders.lastRowBottom = {
      style: convertBorderStyle(border.lastRowBottom.style),
      size: parseBorderWidth(border.lastRowBottom.width, border.lastRowBottom.style),
      color: border.lastRowBottom.color.replace('#', '')
    };
  }

  // Header styles
  if (tableStyle.header.background) {
    docxTableStyle.header.shading = {
      fill: tableStyle.header.background.replace('#', '')
    };
  }
  if (tableStyle.header.fontWeight) {
    docxTableStyle.header.bold = tableStyle.header.fontWeight === 'bold';
  }

  // Cell padding
  const paddingTwips = themeManager.ptToTwips(tableStyle.cell.padding);
  docxTableStyle.cell.margins = {
    top: paddingTwips,
    bottom: paddingTwips,
    left: paddingTwips,
    right: paddingTwips
  };

  // Zebra stripes
  if (tableStyle.zebra?.enabled) {
    docxTableStyle.zebra = {
      even: tableStyle.zebra.evenBackground.replace('#', ''),
      odd: tableStyle.zebra.oddBackground.replace('#', '')
    };
  }

  return docxTableStyle;
}

/**
 * Generate code color mappings for DOCX export
 * @param {Object} codeTheme - Code highlighting theme
 * @param {string} codeBackground - Code background color from theme
 * @returns {Object} Code color mappings
 */
function generateCodeColors(codeTheme, codeBackground) {
  const colorMap = {};

  // Convert color mappings
  Object.keys(codeTheme.colors).forEach((token) => {
    colorMap[token] = codeTheme.colors[token];
  });

  return {
    background: codeBackground?.replace('#', '') || 'f6f8fa',
    foreground: codeTheme.foreground?.replace('#', '') || '24292e',
    colors: colorMap
  };
}

/**
 * Convert CSS border style to DOCX border style
 * @param {string} cssStyle - CSS border style (e.g., 'solid', 'dashed')
 * @returns {BorderStyle} DOCX BorderStyle enum value
 */
function convertBorderStyle(cssStyle) {
  const styleMap = {
    'none': BorderStyle.NONE,
    'solid': BorderStyle.SINGLE,
    'dashed': BorderStyle.DASHED,
    'dotted': BorderStyle.DOTTED,
    'double': BorderStyle.DOUBLE
  };

  return styleMap[cssStyle] || BorderStyle.SINGLE;
}

/**
 * Parse border width from CSS value to DOCX eighths of a point
 * @param {string} width - CSS width (e.g., '1pt', '2px')
 * @param {string} style - Border style (optional, for future use)
 * @returns {number} Width in eighths of a point
 */
function parseBorderWidth(width, style = 'single') {
  const match = width.match(/^(\d+\.?\d*)(pt|px)$/);
  if (!match) return 8; // Default 1pt = 8 eighths

  const value = parseFloat(match[1]);
  const unit = match[2];

  // Keep original width for all border styles
  // DOCX will handle the double border rendering internally

  if (unit === 'pt') {
    return Math.round(value * 8);
  } else if (unit === 'px') {
    // Convert px to pt first (96 DPI: 1px = 0.75pt)
    const pt = value * 0.75;
    return Math.round(pt * 8);
  }

  return 8;
}

/**
 * Load and prepare complete theme configuration for DOCX export
 * @param {string} themeId - Theme ID to load
 * @returns {Promise<Object>} DOCX styles configuration
 */
export async function loadThemeForDOCX(themeId) {
  try {
    // Initialize theme manager first
    await themeManager.initialize();
    
    // Load theme
    const theme = await themeManager.loadTheme(themeId);

    // Load table style
    const tableStyleResponse = await fetch(
      chrome.runtime.getURL(`themes/table-styles/${theme.tableStyle}.json`)
    );
    const tableStyle = await tableStyleResponse.json();

    // Load code theme
    const codeThemeResponse = await fetch(
      chrome.runtime.getURL(`themes/code-themes/${theme.codeTheme}.json`)
    );
    const codeTheme = await codeThemeResponse.json();

    // Load spacing scheme
    const spacingResponse = await fetch(
      chrome.runtime.getURL(`themes/spacing-schemes/${theme.spacing}.json`)
    );
    const spacingScheme = await spacingResponse.json();

    // Generate DOCX styles
    return themeToDOCXStyles(theme, tableStyle, codeTheme, spacingScheme);
  } catch (error) {
    console.error('Error loading theme for DOCX:', error);
    throw error;
  }
}

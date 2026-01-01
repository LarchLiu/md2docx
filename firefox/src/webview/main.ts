// Markdown Viewer Main - Firefox Extension Entry Point
// Uses shared viewer logic from Chrome with Firefox-specific renderer (Background Page DOM)

import { platform } from './index';
import { startViewer, createPluginRenderer } from '../../../chrome/src/webview/viewer-main';

// Create plugin renderer using platform.renderer (Firefox uses Background Page rendering)
const pluginRenderer = createPluginRenderer(async (type, content) => {
  const result = await platform.renderer.render(type, content);
  return {
    base64: result.base64 || '',
    width: result.width,
    height: result.height,
    format: result.format,
    error: result.error,
  };
});

// Start the viewer with Firefox-specific configuration
startViewer({
  platform,
  pluginRenderer,
  themeConfigRenderer: platform.renderer,
});

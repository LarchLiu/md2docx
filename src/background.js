// Background script for handling messages between content script and offscreen document
import ExtensionCacheManager from './cache-manager.js';

let offscreenCreated = false;
let globalCacheManager = null;

// Store scroll positions in memory (per session)
const scrollPositions = new Map();

// Initialize the global cache manager
async function initGlobalCacheManager() {
  try {
    globalCacheManager = new ExtensionCacheManager();
    await globalCacheManager.initDB();
    return globalCacheManager;
  } catch (error) {
    return null;
  }
}

// Initialize cache manager when background script loads
initGlobalCacheManager();

// Monitor offscreen document lifecycle
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen') {
    port.onDisconnect.addListener(() => {
      // Reset state when offscreen document disconnects
      offscreenCreated = false;
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'offscreenReady') {
    offscreenCreated = true;
    return;
  }
  
  if (message.type === 'offscreenDOMReady') {
    return;
  }
  
  if (message.type === 'offscreenError') {
    console.error('Offscreen error:', message.error);
    return;
  }
  
  if (message.type === 'injectContentScript') {
    handleContentScriptInjection(sender.tab.id, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle scroll position management
  if (message.type === 'saveScrollPosition') {
    scrollPositions.set(message.url, message.position);
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'getScrollPosition') {
    const position = scrollPositions.get(message.url) || 0;
    sendResponse({ position });
    return;
  }
  
  if (message.type === 'clearScrollPosition') {
    scrollPositions.delete(message.url);
    sendResponse({ success: true });
    return;
  }
  
  // Handle cache operations
  if (message.action === 'getCacheStats' || message.action === 'clearCache') {
    handleCacheRequest(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle cache operations for content scripts
  if (message.type === 'cacheOperation') {
    handleContentCacheOperation(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Forward rendering messages to offscreen document
  if (message.type === 'renderMermaid' || message.type === 'renderHtml' || message.type === 'renderSvg') {
    handleRenderingRequest(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle local file reading
  if (message.type === 'READ_LOCAL_FILE') {
    handleFileRead(message, sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleContentCacheOperation(message, sendResponse) {
  try {
    // Ensure global cache manager is initialized
    if (!globalCacheManager) {
      globalCacheManager = await initGlobalCacheManager();
    }
    
    if (!globalCacheManager) {
      sendResponse({ error: 'Cache system initialization failed' });
      return;
    }
    
    switch (message.operation) {
      case 'get':
        const item = await globalCacheManager.get(message.key);
        sendResponse({ result: item });
        break;
        
      case 'set':
        await globalCacheManager.set(message.key, message.value, message.dataType);
        sendResponse({ success: true });
        break;
        
      case 'clear':
        await globalCacheManager.clear();
        sendResponse({ success: true });
        break;
        
      case 'getStats':
        const stats = await globalCacheManager.getStats();
        sendResponse({ result: stats });
        break;
        
      default:
        sendResponse({ error: 'Unknown cache operation' });
    }
    
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleCacheRequest(message, sendResponse) {
  try {
    // Ensure global cache manager is initialized
    if (!globalCacheManager) {
      globalCacheManager = await initGlobalCacheManager();
    }
    
    if (!globalCacheManager) {
      sendResponse({
        itemCount: 0,
        maxItems: 1000,
        totalSize: 0,
        totalSizeMB: '0.00',
        items: [],
        message: 'Cache system initialization failed'
      });
      return;
    }
    
    if (message.action === 'getCacheStats') {
      const stats = await globalCacheManager.getStats();
      sendResponse(stats);
    } else if (message.action === 'clearCache') {
      await globalCacheManager.clear();
      sendResponse({ success: true, message: 'Cache cleared successfully' });
    } else {
      sendResponse({ error: 'Unknown cache action' });
    }
    
  } catch (error) {
    sendResponse({ 
      error: error.message,
      itemCount: 0,
      maxItems: 1000,
      totalSize: 0,
      totalSizeMB: '0.00',
      items: [],
      message: 'Cache operation failed'
    });
  }
}

async function handleFileRead(message, sendResponse) {
  try {
    // Use fetch to read the file - this should work from background script
    const response = await fetch(message.filePath);
    
    if (!response.ok) {
      throw new Error(`Failed to read file: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    sendResponse({ content });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleRenderingRequest(message, sendResponse) {
  try {
    // Ensure offscreen document exists
    await ensureOffscreenDocument();
    
    // Send message to offscreen document
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        // Don't immediately reset on communication failure - it might be temporary
        // Only reset if the error suggests the document is gone
        if (chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          offscreenCreated = false;
        }
        sendResponse({ error: `Offscreen communication failed: ${chrome.runtime.lastError.message}` });
      } else if (!response) {
        sendResponse({ error: 'No response from offscreen document. Document may have failed to load.' });
      } else {
        sendResponse(response);
      }
    });
    
  } catch (error) {
    sendResponse({ error: `Offscreen setup failed: ${error.message}` });
  }
}

async function ensureOffscreenDocument() {
  // If already created, return immediately
  if (offscreenCreated) {
    return;
  }
  
  // Try to create offscreen document
  // Multiple concurrent requests might try to create, but that's OK
  try {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['DOM_SCRAPING'],
      justification: 'Render Mermaid diagrams, SVG and HTML to PNG'
    });
    
    offscreenCreated = true;
    
  } catch (error) {
    // If error is about document already existing, that's fine
    if (error.message.includes('already exists') || error.message.includes('Only a single offscreen')) {
      offscreenCreated = true;
      return;
    }
    
    // For other errors, throw them
    throw new Error(`Failed to create offscreen document: ${error.message}`);
  }
}

// Handle dynamic content script injection
async function handleContentScriptInjection(tabId, sendResponse) {
  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['styles.css']
    });
    
    // Then inject JavaScript
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    sendResponse({ error: error.message });
  }
}
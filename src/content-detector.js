// Lightweight content script for detecting Markdown files
// This script runs on all pages to check if they are Markdown files

// Check if this is a markdown file (local or remote)
function isMarkdownFile() {
  const path = document.location.pathname;
  const url = document.location.href;
  
  // First check file extension
  if (!(path.endsWith('.md') || path.endsWith('.markdown'))) {
    return false;
  }
  
  // Check content type from document if available
  const contentType = document.contentType || document.mimeType;
  
  if (contentType) {
    // If content type is HTML, this page has already been processed
    if (contentType.includes('text/html')) {
      return false;
    }
    // Only process if content type is plain text or unknown
    if (contentType.includes('text/plain') || contentType.includes('application/octet-stream')) {
      return true;
    }
  }
  
  // For local files or when content type is not available, check if body contains raw markdown
  const bodyText = document.body ? document.body.textContent : '';
  const bodyHTML = document.body ? document.body.innerHTML : '';
  
  // If the body is already heavily structured HTML (not just pre-wrapped text), 
  // it's likely already processed
  if (bodyHTML.includes('<div') || bodyHTML.includes('<p>') || bodyHTML.includes('<h1') || 
      bodyHTML.includes('<nav') || bodyHTML.includes('<header') || bodyHTML.includes('<footer')) {
    return false;
  }
  
  // If body text looks like raw markdown (contains markdown syntax), process it
  if (bodyText.includes('# ') || bodyText.includes('## ') || bodyText.includes('```') || 
      bodyText.includes('- ') || bodyText.includes('* ') || bodyText.includes('[') && bodyText.includes('](')) {
    return true;
  }
  
  // If it's a .md/.markdown file with plain text content, assume it's markdown
  return true;
}

// Only run the main content script if this is a Markdown file
if (isMarkdownFile()) {
  // Dynamically inject the original content script
  chrome.runtime.sendMessage({
    type: 'injectContentScript',
    url: document.location.href
  });
}
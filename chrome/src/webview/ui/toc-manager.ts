// Table of Contents Manager
// Handles TOC generation, toggle, and active item tracking

interface FileState {
  tocVisible?: boolean;
  [key: string]: unknown;
}

type SaveFileStateFunction = (state: FileState) => void;
type GetFileStateFunction = () => Promise<FileState>;

interface TocManager {
  generateTOC(): Promise<void>;
  setupTocToggle(): () => void;
  updateActiveTocItem(): void;
  scrollTocToActiveItem(activeLink: Element, tocDiv: Element): void;
  setupResponsiveToc(): Promise<void>;
}

/**
 * Creates a TOC manager for handling table of contents functionality.
 * @param saveFileState - Function to save file state
 * @param getFileState - Function to get file state
 * @returns TOC manager instance
 */
export function createTocManager(saveFileState: SaveFileStateFunction, getFileState: GetFileStateFunction): TocManager {
  /**
   * Generate table of contents from headings
   */
  async function generateTOC(): Promise<void> {
    const contentDiv = document.getElementById('markdown-content');
    const tocDiv = document.getElementById('table-of-contents');

    if (!contentDiv || !tocDiv) return;

    const headings = contentDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');

    if (headings.length === 0) {
      tocDiv.style.display = 'none';
      document.body.classList.add('toc-hidden');
      return;
    }

    // Generate TOC list only
    let tocHTML = '<ul class="toc-list">';

    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName[1]);
      const text = heading.textContent;
      const id = heading.id || `heading-${index}`;

      if (!heading.id) {
        heading.id = id;
      }

      const indent = (level - 1) * 20;
      tocHTML += `<li style="margin-left: ${indent}px"><a href="#${id}">${text}</a></li>`;
    });

    tocHTML += '</ul>';
    tocDiv.innerHTML = tocHTML;
    
    // Apply saved TOC visibility state after generating TOC
    const savedState = await getFileState();
    const overlayDiv = document.getElementById('toc-overlay');
    
    if (overlayDiv) {
      // Determine desired visibility: use saved state if available, otherwise use responsive default
      let shouldBeVisible: boolean;
      if (savedState.tocVisible !== undefined) {
        shouldBeVisible = savedState.tocVisible;
      } else {
        // No saved state - use responsive default
        shouldBeVisible = window.innerWidth > 1024;
      }
      
      const currentlyVisible = !tocDiv.classList.contains('hidden');
      
      // Only update if state doesn't match
      if (shouldBeVisible !== currentlyVisible) {
        if (!shouldBeVisible) {
          // Hide TOC
          tocDiv.classList.add('hidden');
          document.body.classList.add('toc-hidden');
          overlayDiv.classList.add('hidden');
        } else {
          // Show TOC
          tocDiv.classList.remove('hidden');
          document.body.classList.remove('toc-hidden');
          overlayDiv.classList.remove('hidden');
        }
      }
    }
  }

  /**
   * Setup TOC toggle functionality
   * @returns Toggle function
   */
  function setupTocToggle(): () => void {
    const tocDiv = document.getElementById('table-of-contents');
    const overlayDiv = document.getElementById('toc-overlay');

    if (!tocDiv || !overlayDiv) return () => {};

    const toggleToc = (): void => {
      const willBeHidden = !tocDiv.classList.contains('hidden');
      tocDiv.classList.toggle('hidden');
      document.body.classList.toggle('toc-hidden');
      overlayDiv.classList.toggle('hidden');
      
      // Save TOC visibility state
      saveFileState({
        tocVisible: !willBeHidden
      });
    };

    // Close TOC when clicking overlay (for mobile)
    overlayDiv.addEventListener('click', toggleToc);

    // Return toggleToc function for use by toolbar button and keyboard shortcuts
    return toggleToc;
  }

  /**
   * Update active TOC item based on scroll position
   * Highlights the last heading that is above the viewport top
   */
  function updateActiveTocItem(): void {
    const contentDiv = document.getElementById('markdown-content');
    const tocDiv = document.getElementById('table-of-contents');
    
    if (!contentDiv || !tocDiv) return;
    
    const headings = contentDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return;
    
    // Get current scroll position
    const scrollTop = window.scrollY || window.pageYOffset;
    
    // Get current zoom level
    let currentZoom = 1;
    if ((contentDiv as HTMLElement).style.zoom) {
      currentZoom = parseFloat((contentDiv as HTMLElement).style.zoom) || 1;
    }

    // Threshold: toolbar height (50px) + small tolerance (10px)
    // Scale threshold with zoom to ensure accurate detection
    // Use Math.max to ensure threshold is never too small for low zoom levels
    const threshold = Math.max(60, 60 * currentZoom);
    
    // Find the last heading that is above or near the viewport top
    let activeHeading: Element | null = null;
    
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const headingTop = heading.getBoundingClientRect().top + scrollTop;
      
      // If heading is above viewport top + threshold
      if (headingTop <= scrollTop + threshold) {
        activeHeading = heading;
      } else {
        // Headings are in order, so we can break once we find one below
        break;
      }
    }
    
    // Update TOC highlighting
    const tocLinks = tocDiv.querySelectorAll('a');
    tocLinks.forEach(link => {
      link.classList.remove('active');
    });
    
    if (activeHeading && activeHeading.id) {
      const activeLink = tocDiv.querySelector(`a[href="#${activeHeading.id}"]`);
      if (activeLink) {
        activeLink.classList.add('active');
        
        // Scroll TOC to make active item visible
        scrollTocToActiveItem(activeLink, tocDiv);
      }
    }
  }

  /**
   * Scroll TOC container to ensure active item is visible
   * @param activeLink - The active TOC link element
   * @param tocDiv - The TOC container element
   */
  function scrollTocToActiveItem(activeLink: Element, tocDiv: Element): void {
    if (!activeLink || !tocDiv) return;
    
    const linkRect = activeLink.getBoundingClientRect();
    const tocRect = tocDiv.getBoundingClientRect();
    
    // Calculate if link is outside visible area
    const linkTop = linkRect.top - tocRect.top + tocDiv.scrollTop;
    const linkBottom = linkTop + linkRect.height;
    
    const visibleTop = tocDiv.scrollTop;
    const visibleBottom = visibleTop + (tocDiv as HTMLElement).clientHeight;
    
    // Add some padding for better UX
    const padding = 20;
    
    if (linkTop < visibleTop + padding) {
      // Link is above visible area, scroll up
      tocDiv.scrollTop = linkTop - padding;
    } else if (linkBottom > visibleBottom - padding) {
      // Link is below visible area, scroll down
      tocDiv.scrollTop = linkBottom - (tocDiv as HTMLElement).clientHeight + padding;
    }
  }

  /**
   * Setup responsive TOC behavior
   */
  async function setupResponsiveToc(): Promise<void> {
    const tocDiv = document.getElementById('table-of-contents');

    if (!tocDiv) return;

    const handleResize = async (): Promise<void> => {
      const savedState = await getFileState();
      
      if (window.innerWidth <= 1024) {
        // On smaller screens, hide TOC by default (unless user explicitly wants it shown)
        if (savedState.tocVisible === undefined || savedState.tocVisible === false) {
          tocDiv.classList.add('hidden');
          document.body.classList.add('toc-hidden');
          const overlayDiv = document.getElementById('toc-overlay');
          if (overlayDiv) {
            overlayDiv.classList.add('hidden');
          }
        }
      }
      // On larger screens, respect user's saved preference (don't force show)
    };

    // Don't set initial state here - it's already set by generateTOC()
    // Only listen for window resize
    window.addEventListener('resize', handleResize);
  }

  return {
    generateTOC,
    setupTocToggle,
    updateActiveTocItem,
    scrollTocToActiveItem,
    setupResponsiveToc
  };
}

/**
 * VSCode Search Panel Component
 * 
 * A search bar that appears at the top of the preview panel.
 * Includes: search input, previous/next navigation, match counter.
 * 
 * Features:
 * - Case-sensitive/insensitive search
 * - Regular expression support
 * - Navigation between matches
 * - Result count display
 * - Keyboard shortcuts (Escape to close, Enter to next, Shift+Enter to previous)
 */

import Localization from '../../../src/utils/localization';

export interface SearchPanelOptions {
  /** Search callback - returns matches array */
  onSearch?: (query: string, options: SearchOptions) => HighlightMatch[];
  /** Clear highlights callback */
  onClear?: () => void;
  /** Navigate to match callback */
  onNavigate?: (index: number) => void;
  /** Close panel callback */
  onClose?: () => void;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export interface HighlightMatch {
  element: HTMLElement;
  startOffset: number;
  endOffset: number;
}

export interface SearchPanel {
  /** Show the search panel */
  show: () => void;
  /** Hide the search panel */
  hide: () => void;
  /** Check if panel is visible */
  isVisible: () => boolean;
  /** Focus search input */
  focus: () => void;
  /** Update match count display */
  setMatchCount: (current: number, total: number) => void;
  /** Update localization texts */
  updateLocalization: () => void;
  /** Clear search results */
  clear: () => void;
  /** Get the panel element */
  getElement: () => HTMLElement;
  /** Cleanup */
  dispose: () => void;
}

/**
 * Create search panel
 */
export function createSearchPanel(options: SearchPanelOptions = {}): SearchPanel {
  const {
    onSearch,
    onClear,
    onNavigate,
    onClose
  } = options;

  let visible = false;
  let currentMatches: HighlightMatch[] = [];
  let currentMatchIndex = 0;
  let searchQuery = '';
  let searchOptions: SearchOptions = {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false
  };

  // Create panel container
  const panel = document.createElement('div');
  panel.className = 'vscode-search-panel';
  panel.style.display = 'none';

  panel.innerHTML = `
    <div class="vscode-search-container">
      <div class="vscode-search-input-wrapper">
        <input 
          type="text" 
          class="vscode-search-input" 
          placeholder="${Localization.translate('search_placeholder') || 'Find (↑↓ for history)'}"
          aria-label="Search"
        />
        <button class="vscode-search-case-btn" title="${Localization.translate('search_case_sensitive') || 'Match Case'}" data-i18n-title="search_case_sensitive">Aa</button>
        <button class="vscode-search-word-btn" title="${Localization.translate('search_whole_word') || 'Match Whole Word'}" data-i18n-title="search_whole_word"><u>ab</u></button>
      </div>
      <div class="vscode-search-nav-group">
        <span class="vscode-search-count no-results">-</span>
        <button class="vscode-search-prev-btn" title="${Localization.translate('search_previous') || 'Previous'}" data-i18n-title="search_previous">↑</button>
        <button class="vscode-search-next-btn" title="${Localization.translate('search_next') || 'Next'}" data-i18n-title="search_next">↓</button>
        <button class="vscode-search-close-btn" title="${Localization.translate('close') || 'Close'}" data-i18n-title="close">×</button>
      </div>
    </div>
  `;

  // Get elements
  const searchInput = panel.querySelector('.vscode-search-input') as HTMLInputElement;
  const caseBtn = panel.querySelector('.vscode-search-case-btn') as HTMLButtonElement;
  const wordBtn = panel.querySelector('.vscode-search-word-btn') as HTMLButtonElement;
  const prevBtn = panel.querySelector('.vscode-search-prev-btn') as HTMLButtonElement;
  const nextBtn = panel.querySelector('.vscode-search-next-btn') as HTMLButtonElement;
  const closeBtn = panel.querySelector('.vscode-search-close-btn') as HTMLButtonElement;
  const countSpan = panel.querySelector('.vscode-search-count') as HTMLElement;

  // Helper functions
  function updateMatchCount(current: number, total: number): void {
    if (total === 0) {
      countSpan.textContent = '-';
      countSpan.classList.add('no-results');
    } else {
      countSpan.textContent = `${current + 1} / ${total}`;
      countSpan.classList.remove('no-results');
    }
  }

  function performSearch(): void {
    const query = searchInput.value;
    
    if (!query) {
      currentMatches = [];
      currentMatchIndex = 0;
      updateMatchCount(0, 0);
      onClear?.();
      return;
    }

    searchQuery = query;
    currentMatches = onSearch?.(query, searchOptions) ?? [];
    currentMatchIndex = 0;
    
    updateMatchCount(currentMatchIndex, currentMatches.length);
    
    if (currentMatches.length > 0) {
      onNavigate?.(currentMatchIndex);
    }
  }

  function navigatePrevious(): void {
    if (currentMatches.length === 0) return;
    
    currentMatchIndex = (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
    updateMatchCount(currentMatchIndex, currentMatches.length);
    onNavigate?.(currentMatchIndex);
  }

  function navigateNext(): void {
    if (currentMatches.length === 0) return;
    
    currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
    updateMatchCount(currentMatchIndex, currentMatches.length);
    onNavigate?.(currentMatchIndex);
  }

  function toggleSearchOption(option: keyof SearchOptions): void {
    searchOptions[option] = !searchOptions[option];
    if (searchQuery) {
      performSearch();
    }
  }

  // Bind events
  searchInput.addEventListener('input', () => {
    performSearch();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        navigatePrevious();
      } else {
        navigateNext();
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      hide();
      onClose?.();
      e.preventDefault();
    }
  });

  caseBtn.addEventListener('click', () => {
    toggleSearchOption('caseSensitive');
    caseBtn.classList.toggle('active', searchOptions.caseSensitive);
  });

  wordBtn.addEventListener('click', () => {
    toggleSearchOption('wholeWord');
    wordBtn.classList.toggle('active', searchOptions.wholeWord);
  });

  prevBtn.addEventListener('click', navigatePrevious);
  nextBtn.addEventListener('click', navigateNext);

  closeBtn.addEventListener('click', () => {
    hide();
    onClose?.();
  });

  function show(): void {
    if (visible) return;
    visible = true;
    panel.style.display = 'flex';
    // Focus input after a microtask to ensure display is applied
    setTimeout(() => searchInput.focus(), 0);
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    panel.style.display = 'none';
    searchInput.value = '';
    currentMatches = [];
    currentMatchIndex = 0;
    searchQuery = '';
    updateMatchCount(0, 0);
    onClear?.();
  }

  function focus(): void {
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function updateLocalization(): void {
    searchInput.placeholder = Localization.translate('search_placeholder') || 'Find';
    caseBtn.title = Localization.translate('search_case_sensitive') || 'Match Case';
    wordBtn.title = Localization.translate('search_whole_word') || 'Match Whole Word';
    prevBtn.title = Localization.translate('search_previous') || 'Previous Match';
    nextBtn.title = Localization.translate('search_next') || 'Next Match';
    closeBtn.title = Localization.translate('close') || 'Close';
  }

  return {
    show,
    hide,
    isVisible: () => visible,
    focus,
    setMatchCount: updateMatchCount,
    updateLocalization,
    clear: () => {
      searchInput.value = '';
      currentMatches = [];
      currentMatchIndex = 0;
      updateMatchCount(0, 0);
      onClear?.();
    },
    getElement: () => panel,
    dispose: () => {
      panel.remove();
    }
  };
}

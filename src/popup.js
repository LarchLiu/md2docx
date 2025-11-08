// Markdown Viewer Extension - Popup Script

// Note: Popup cannot access IndexedDB directly due to security restrictions
// We use BackgroundCacheProxy to communicate with content scripts through background script

import Localization, { DEFAULT_SETTING_LOCALE } from './localization.js';

const translate = (key, substitutions) => Localization.translate(key, substitutions);

const getUiLocale = () => {
  const selectedLocale = Localization.getLocale();
  if (selectedLocale && selectedLocale !== DEFAULT_SETTING_LOCALE) {
    return selectedLocale.replace('_', '-');
  }

  if (chrome?.i18n?.getUILanguage) {
    return chrome.i18n.getUILanguage();
  }
  return 'en';
};

const applyI18nText = () => {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach((element) => {
    const { i18n: key, version, i18nArgs } = element.dataset;
    let substitutions;

    if (i18nArgs) {
      substitutions = i18nArgs.split('|');
    } else if (version) {
      substitutions = [version];
    }

    const message = translate(key, substitutions);
    if (message) {
      element.textContent = message;
    }
  });

  const attributeElements = document.querySelectorAll('[data-i18n-attr]');
  attributeElements.forEach((element) => {
    const mapping = element.dataset.i18nAttr;
    if (!mapping) {
      return;
    }

    mapping.split(',').forEach((pair) => {
      const [attrRaw, key] = pair.split(':');
      if (!attrRaw || !key) {
        return;
      }

      const attrName = attrRaw.trim();
      const message = translate(key.trim());
      if (attrName && message) {
        element.setAttribute(attrName, message);
      }
    });
  });
};

// Backup proxy for cache operations via background script
class BackgroundCacheProxy {
  constructor() {
    this.maxItems = 1000;
  }

  async getStats() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getCacheStats'
      });

      if (response && response.error) {
        throw new Error(response.error);
      }

      if (!response) {
        return {
          itemCount: 0,
          maxItems: this.maxItems,
          totalSize: 0,
          totalSizeMB: '0.00',
          items: []
        };
      }

      return response;
    } catch (error) {
      console.error('Failed to get cache stats via background:', error);
      return {
        itemCount: 0,
        maxItems: this.maxItems,
        totalSize: 0,
        totalSizeMB: '0.00',
        items: [],
        message: translate('cache_error_message')
      };
    }
  }

  async clear() {
    try {
      return await chrome.runtime.sendMessage({
        action: 'clearCache'
      });
    } catch (error) {
      console.error('Failed to clear cache via background:', error);
      throw error;
    }
  }
}

class PopupManager {
  constructor() {
    this.cacheManager = null;
    this.currentTab = 'overview';
    this.settings = {
      maxCacheItems: 1000,
      preferredLocale: DEFAULT_SETTING_LOCALE
    };

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.initCacheManager();

    if (this.currentTab === 'cache') {
      this.loadCacheData();
    }
  }

  async initCacheManager() {
    this.cacheManager = new BackgroundCacheProxy();

    try {
      await this.loadCacheData();
    } catch (error) {
      console.error('Failed to load cache data:', error);
        this.showError(translate('cache_system_unavailable') || 'Cache system unavailable - open a Markdown file first');
      this.showManualCacheInfo();
    }
  }

  resetCacheView() {
    const statsPlaceholders = [
      document.getElementById('cache-stat-item-count'),
      document.getElementById('cache-stat-size'),
      document.getElementById('cache-stat-usage'),
      document.getElementById('cache-stat-capacity')
    ];

    statsPlaceholders.forEach((el) => {
      if (el) {
        el.textContent = '--';
      }
    });

    const itemsEl = document.getElementById('cache-items');
    if (itemsEl) {
      itemsEl.dataset.empty = 'true';
      itemsEl.querySelectorAll('[data-cache-item="dynamic"]').forEach((element) => {
        element.remove();
      });
    }

    this.updateCacheMessage('', '');
  }

  updateCacheMessage(primaryText, detailText) {
    const primaryEl = document.getElementById('cache-message-text');
    const detailEl = document.getElementById('cache-message-details');
    const container = document.getElementById('cache-message');

    if (primaryEl) {
      primaryEl.textContent = primaryText || '';
    }

    if (detailEl) {
      detailEl.textContent = detailText || '';
    }

    if (container) {
      const hasContent = Boolean(primaryText?.trim() || detailText?.trim());
      container.hidden = !hasContent;
    }
  }

  setupEventListeners() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', (event) => {
        const tabName = event.currentTarget.dataset.tab;
        this.switchTab(tabName);
      });
    });

    const refreshBtn = document.getElementById('refresh-cache');
    const clearBtn = document.getElementById('clear-cache');
    const saveBtn = document.getElementById('save-settings');
    const resetBtn = document.getElementById('reset-settings');
    const demoBtn = document.getElementById('demo-link');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadCacheData();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearCache();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saveSettings();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        this.openDemo();
      });
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.remove('active');
    });

    const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeTab) {
      activeTab.classList.add('active');
    }

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.remove('active');
    });

    const activePanel = document.getElementById(tabName);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    this.currentTab = tabName;

    if (tabName === 'cache') {
      this.loadCacheData();
    } else if (tabName === 'settings') {
      this.loadSettingsUI();
    }
  }

  async loadCacheData() {
    this.resetCacheView();

    try {
      if (!this.cacheManager) {
        await this.initCacheManager();
      }

      if (!this.cacheManager) {
        throw new Error(translate('cache_manager_init_failed') || 'Cache manager initialization failed');
      }

      const stats = await this.cacheManager.getStats();

      this.renderCacheStats(stats);

      let items = [];
      if (stats.indexedDBCache?.items) {
        items = stats.indexedDBCache.items;
      } else if (stats.items) {
        items = stats.items;
      }

      this.renderCacheItems(items);
    } catch (error) {
      console.error('Failed to load cache data:', error);
      const fallbackMessage = translate('cache_loading_failed', [error.message || '']);
      this.updateCacheMessage(fallbackMessage, '');
    }
  }

  renderCacheStats(stats) {
    if (!stats) {
      return;
    }

    let itemCount = 0;
    let totalSizeMB = '0.00';
    let maxItems = 1000;

    if (stats.indexedDBCache) {
      itemCount = stats.indexedDBCache.itemCount || 0;
      totalSizeMB = stats.indexedDBCache.totalSizeMB || '0.00';
      maxItems = stats.indexedDBCache.maxItems || 1000;
    } else {
      itemCount = stats.itemCount || 0;
      totalSizeMB = stats.totalSizeMB || '0.00';
      maxItems = stats.maxItems || 1000;
    }

    const itemCountEl = document.getElementById('cache-stat-item-count');
    const sizeEl = document.getElementById('cache-stat-size');
    const usageEl = document.getElementById('cache-stat-usage');
    const capacityEl = document.getElementById('cache-stat-capacity');

    if (itemCount === 0) {
      const hintDetails = translate('cache_hint_details') || '';
      if (itemCountEl) {
        itemCountEl.textContent = '0';
      }
      if (sizeEl) {
        sizeEl.textContent = '0.00MB';
      }
      if (usageEl) {
        usageEl.textContent = '0%';
      }
      if (capacityEl) {
        capacityEl.textContent = `${maxItems}`;
      }
      if (stats.message) {
        this.updateCacheMessage(`Hint: ${stats.message}`, hintDetails);
      } else {
        this.updateCacheMessage('', '');
      }
      return;
    }

    const usagePercent = Math.round((itemCount / maxItems) * 100);

    if (itemCountEl) {
      itemCountEl.textContent = `${itemCount}`;
    }
    if (sizeEl) {
      sizeEl.textContent = `${totalSizeMB}MB`;
    }
    if (usageEl) {
      usageEl.textContent = `${usagePercent}%`;
    }
    if (capacityEl) {
      capacityEl.textContent = `${maxItems}`;
    }

    this.updateCacheMessage('', '');
  }

  renderCacheItems(items) {
    const itemsEl = document.getElementById('cache-items');
    const template = document.getElementById('cache-item-template');

    if (!itemsEl || !template) {
      return;
    }

    let allItems = [];

    if (Array.isArray(items)) {
      allItems = items;
    } else if (items && typeof items === 'object') {
      if (Array.isArray(items.indexedDBCache?.items)) {
        allItems = items.indexedDBCache.items;
      }
    }

    itemsEl.querySelectorAll('[data-cache-item="dynamic"]').forEach((element) => {
      element.remove();
    });

    if (allItems.length === 0) {
      itemsEl.dataset.empty = 'true';
      return;
    }

    itemsEl.dataset.empty = 'false';

    const typeLabel = translate('cache_item_type_label') || 'Type';
    const sizeLabel = translate('cache_item_size_label') || 'Size';
    const createdLabel = translate('cache_item_created_label') || 'Created';
    const accessedLabel = translate('cache_item_accessed_label') || 'Last accessed';
    const unknownType = translate('cache_item_type_unknown') || 'unknown';
    const locale = getUiLocale();

    const fragment = document.createDocumentFragment();

    allItems.forEach((item) => {
      const cacheItemEl = template.content.firstElementChild.cloneNode(true);
      cacheItemEl.dataset.cacheItem = 'dynamic';

      const keyEl = cacheItemEl.querySelector('.cache-item-key');
      const typeEl = cacheItemEl.querySelector('.cache-item-type');
      const sizeEl = cacheItemEl.querySelector('.cache-item-size');
      const createdEl = cacheItemEl.querySelector('.cache-item-created');
      const accessedEl = cacheItemEl.querySelector('.cache-item-accessed');

      if (keyEl) {
        keyEl.textContent = item.key;
      }

      if (typeEl) {
        typeEl.textContent = `${typeLabel}: ${item.type || unknownType}`;
      }

      const sizeMB = item.sizeMB || (item.size ? (item.size / (1024 * 1024)).toFixed(3) : '0.000');
      if (sizeEl) {
        sizeEl.textContent = `${sizeLabel}: ${sizeMB}MB`;
      }

      if (createdEl) {
        createdEl.textContent = item.created
          ? `${createdLabel}: ${new Date(item.created).toLocaleString(locale)}`
          : '';
      }

      if (accessedEl) {
        accessedEl.textContent = item.lastAccess
          ? `${accessedLabel}: ${new Date(item.lastAccess).toLocaleString(locale)}`
          : '';
      }

      fragment.appendChild(cacheItemEl);
    });

    itemsEl.appendChild(fragment);
  }

  async clearCache() {
    const confirmMessage = translate('cache_clear_confirm') || 'Clear all cached data? This action cannot be undone.';
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      if (!this.cacheManager) {
        await this.initCacheManager();
      }

      await this.cacheManager.clear();
      this.loadCacheData();
      this.showMessage(translate('cache_clear_success') || 'Cache cleared', 'success');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      this.showMessage(translate('cache_clear_failed') || 'Failed to clear cache', 'error');
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['markdownViewerSettings']);
      if (result.markdownViewerSettings) {
        this.settings = { ...this.settings, ...result.markdownViewerSettings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  loadSettingsUI() {
    const maxCacheItemsEl = document.getElementById('max-cache-items');
    if (maxCacheItemsEl) {
      maxCacheItemsEl.value = this.settings.maxCacheItems;
    }

    const localeSelect = document.getElementById('interface-language');
    if (localeSelect) {
      localeSelect.value = this.settings.preferredLocale || DEFAULT_SETTING_LOCALE;
    }
  }

  async saveSettings() {
    try {
      const maxCacheItemsEl = document.getElementById('max-cache-items');
      const maxCacheItems = parseInt(maxCacheItemsEl.value, 10);
      const localeSelect = document.getElementById('interface-language');
      const preferredLocale = localeSelect ? localeSelect.value : DEFAULT_SETTING_LOCALE;

      if (Number.isNaN(maxCacheItems) || maxCacheItems < 100 || maxCacheItems > 5000) {
        this.showMessage(
          translate('settings_invalid_max_cache', ['100', '5000']) || 'Enter a valid cache size between 100 and 5000',
          'error'
        );
        return;
      }

      this.settings.maxCacheItems = maxCacheItems;
      this.settings.preferredLocale = preferredLocale;

      await chrome.storage.local.set({
        markdownViewerSettings: this.settings
      });

      await Localization.setPreferredLocale(preferredLocale);
      chrome.runtime.sendMessage({ type: 'localeChanged', locale: preferredLocale }).catch(() => {});
      applyI18nText();
      this.loadSettingsUI();

      if (this.currentTab === 'cache') {
        this.loadCacheData();
      }

      if (this.cacheManager && this.cacheManager.maxItems !== maxCacheItems) {
        this.cacheManager.maxItems = maxCacheItems;
      }

      this.showMessage(translate('settings_save_success') || 'Settings saved', 'success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showMessage(translate('settings_save_failed') || 'Failed to save settings', 'error');
    }
  }

  async resetSettings() {
    const confirmMessage = translate('settings_reset_confirm') || 'Reset all settings to default values?';
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      this.settings = {
        maxCacheItems: 1000,
        preferredLocale: DEFAULT_SETTING_LOCALE
      };

      await chrome.storage.local.set({
        markdownViewerSettings: this.settings
      });

      await Localization.setPreferredLocale(DEFAULT_SETTING_LOCALE);
      chrome.runtime.sendMessage({ type: 'localeChanged', locale: DEFAULT_SETTING_LOCALE }).catch(() => {});
      applyI18nText();

      if (this.currentTab === 'cache') {
        this.loadCacheData();
      }

      this.loadSettingsUI();
      this.showMessage(translate('settings_reset_success') || 'Settings reset', 'success');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      this.showMessage(translate('settings_reset_failed') || 'Failed to reset settings', 'error');
    }
  }

  showMessage(text, type = 'info') {
    const message = document.createElement('div');
    message.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    message.textContent = text;

    document.body.appendChild(message);

    setTimeout(() => {
      message.style.opacity = '1';
    }, 100);

    setTimeout(() => {
      message.style.opacity = '0';
      setTimeout(() => {
        if (message.parentElement) {
          message.parentElement.removeChild(message);
        }
      }, 300);
    }, 2000);
  }

  showError(text) {
    console.error('Popup Error:', text);
    this.showMessage(`Error: ${text}`);
  }

  async openDemo() {
    try {
      const demoUrl = 'https://raw.githubusercontent.com/xicilion/markdown-viewer-extension/refs/heads/main/test/test.md';

      await chrome.tabs.create({
        url: demoUrl,
        active: true
      });

      window.close();
    } catch (error) {
      console.error('Failed to open demo:', error);
      this.showMessage(translate('demo_open_failed') || 'Failed to open demo document', 'error');
    }
  }

  showManualCacheInfo() {
    this.resetCacheView();

    const manualLimitTitle = translate('cache_manual_limit_title') || 'Cache access limits';
    const manualLimitDesc1 = translate('cache_manual_limit_desc_1') || 'For security reasons the popup cannot access IndexedDB directly.';
    const manualLimitDesc2 = translate('cache_manual_limit_desc_2') || 'Caching works while rendering Markdown pages but details are unavailable here.';
    const manualStatusTitle = translate('cache_manual_status_title') || 'Check cache status';
    const manualStatusIntro = translate('cache_manual_status_intro') || 'To make sure caching works:';
    const manualStatusStepOpen = translate('cache_manual_status_step_open') || 'Open a Markdown file';
    const manualStatusStepSpeed = translate('cache_manual_status_step_speed') || 'Notice faster renders when cache is warm';
  const manualStatusStepConsole = translate('cache_manual_status_step_console') || 'Check for "Using cached" logs in DevTools';
    const manualClearTitle = translate('cache_manual_clear_title') || 'Clear cache manually';
    const manualClearIntro = translate('cache_manual_clear_intro') || 'To clear cache manually:';
    const manualClearCode = 'window.extensionRenderer?.cacheManager?.clear()';
    const manualClearStep1 = translate('cache_manual_clear_step_1') || 'Open any Markdown file';
    const manualClearStep2 = translate('cache_manual_clear_step_2') || 'Press F12 to open DevTools';
    const manualClearStep3Raw = translate('cache_manual_clear_step_3', [manualClearCode]) || `Run "${manualClearCode}" in the console`;

    const primaryMessage = `${manualLimitTitle}
${manualLimitDesc1}
${manualLimitDesc2}`;
    const detailMessage = `${manualStatusTitle}
${manualStatusIntro}
- ${manualStatusStepOpen}
- ${manualStatusStepSpeed}
- ${manualStatusStepConsole}

${manualClearTitle}
${manualClearIntro}
1. ${manualClearStep1}
2. ${manualClearStep2}
3. ${manualClearStep3Raw}`;

    this.updateCacheMessage(primaryMessage, detailMessage);
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Localization.init();
    applyI18nText();
    const popupManager = new PopupManager();

    window.popupManager = popupManager;
  } catch (error) {
    console.error('Failed to create PopupManager:', error);
  }
});

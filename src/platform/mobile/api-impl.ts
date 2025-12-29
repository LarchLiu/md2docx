/**
 * Mobile Platform API Implementation
 * 
 * Runs in WebView context, communicates with the host app (Flutter) via JavaScript channel.
 */

import {
  BaseI18nService,
  DEFAULT_SETTING_LOCALE,
  FALLBACK_LOCALE
} from '../shared/index';

import type {
  LocaleMessages
} from '../shared/index';

import type { PlatformBridgeAPI } from '../../types/index';

import { ServiceChannel } from '../../messaging/channels/service-channel';
import { RenderChannel } from '../../messaging/channels/render-channel';
import { FlutterJsChannelTransport } from '../../messaging/transports/flutter-jschannel-transport';
import { WindowPostMessageTransport } from '../../messaging/transports/window-postmessage-transport';

import { IframeRenderHost } from '../../renderers/host/iframe-render-host';

import { CacheService, StorageService, FileService, RendererService } from '../../services';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Pending request entry
 */
interface HostMessage {
  type?: string;
  payload?: unknown;
  [key: string]: unknown;
}

/**
 * Download options
 */
interface DownloadOptions {
  mimeType?: string;
  [key: string]: unknown;
}

/**
 * Window extensions for mobile platform
 */
declare global {
  interface Window {
    MarkdownViewer?: {
      postMessage: (message: string) => void;
    };
    __receiveMessageFromHost?: (payload: unknown) => void;
    __mobilePlatformCache?: CacheService;
  }
}

// ============================================================================
// Service Channel (Host ↔ WebView)
// ============================================================================

const hostServiceChannel = new ServiceChannel(new FlutterJsChannelTransport(), {
  source: 'mobile-webview',
  timeoutMs: 30000,
});

// Unified cache service (same as Chrome/VSCode)
const cacheService = new CacheService(hostServiceChannel);

// Unified storage service (same as Chrome/VSCode)
const storageService = new StorageService(hostServiceChannel);

// Unified file service (same as Chrome/VSCode, but without forced chunked upload)
const fileService = new FileService(hostServiceChannel);

// Bridge compatibility layer (used by mobile/main.ts and some plugins).
// NOTE: sendRequest/postMessage now use unified envelopes under the hood.
export const bridge: PlatformBridgeAPI = {
  sendRequest: async <T = unknown>(type: string, payload: unknown): Promise<T> => {
    return (await hostServiceChannel.send(type, payload)) as T;
  },
  postMessage: (type: string, payload: unknown): void => {
    hostServiceChannel.post(type, payload);
  },
  addListener: (handler: (message: unknown) => void): (() => void) => {
    return hostServiceChannel.onAny((message) => {
      handler(message);
    });
  },
};

// ============================================================================
// Mobile Resource Service
// ============================================================================

/**
 * Mobile Resource Service
 * Resources are bundled with the app
 */
class MobileResourceService {
  getURL(path: string): string {
    // In mobile WebView loaded via loadFlutterAsset, we need absolute asset URLs
    // Using relative paths from the loaded HTML should work
    return `./${path}`;
  }

  /**
   * Fetch asset content via Flutter bridge
   * WebView's native fetch doesn't work reliably with Flutter assets
   * @param path - Asset path relative to webview folder
   * @returns Asset content as string
   */
  async fetch(path: string): Promise<string> {
    return bridge.sendRequest('FETCH_ASSET', { path });
  }
}

// ============================================================================
// Mobile Message Service
// ============================================================================

/**
 * Mobile Message Service
 * Handles Host ↔ WebView communication
 */
class MobileMessageService {
  send<T = unknown>(message: unknown): Promise<T> {
    return bridge.sendRequest('MESSAGE', message);
  }

  addListener(callback: (message: unknown) => void): () => void {
    return bridge.addListener(callback);
  }
}

// ============================================================================
// Mobile I18n Service
// ============================================================================

/**
 * Mobile I18n Service
 * Loads locale data from bundled JSON files
 * Extends BaseI18nService for common message lookup logic
 */
class MobileI18nService extends BaseI18nService {
  constructor() {
    super();
  }

  async init(): Promise<void> {
    try {
      await this.ensureFallbackMessages();
      // For mobile, we use system locale by default
      this.ready = Boolean(this.messages || this.fallbackMessages);
    } catch (error) {
      console.warn('[I18n] init failed:', error);
      this.ready = Boolean(this.fallbackMessages);
    }
  }

  async loadLocale(locale: string): Promise<void> {
    try {
      this.messages = await this.fetchLocaleData(locale);
      this.locale = locale;
      this.ready = Boolean(this.messages || this.fallbackMessages);
    } catch (e) {
      console.warn('Failed to load locale:', locale, e);
      this.messages = null;
      this.ready = Boolean(this.fallbackMessages);
    }
  }

  async fetchLocaleData(locale: string): Promise<LocaleMessages | null> {
    try {
      const response = await fetch(`./_locales/${locale}/messages.json`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (error) {
      console.warn('[I18n] fetchLocaleData failed for', locale, error);
      return null;
    }
  }

  getUILanguage(): string {
    return navigator.language || 'en';
  }
}

// ============================================================================
// Mobile Platform API
// ============================================================================

/**
 * Mobile Platform API
 * Implements PlatformAPI interface for mobile WebView environment
 */
class MobilePlatformAPI {
  public readonly platform = 'mobile' as const;
  
  // Services
  public readonly storage: StorageService;
  public readonly file: FileService;
  public readonly resource: MobileResourceService;
  public readonly message: MobileMessageService;
  public readonly cache: CacheService;
  public readonly renderer: RendererService;
  public readonly i18n: MobileI18nService;
  
  // Internal bridge reference (for advanced usage)
  public readonly _bridge: PlatformBridgeAPI;

  constructor() {
    // Initialize services
    this.storage = storageService; // Use unified storage service
    this.file = fileService;       // Use unified file service
    this.resource = new MobileResourceService();
    this.message = new MobileMessageService();
    this.cache = cacheService; // Use unified cache service
    
    // Unified renderer service with IframeRenderHost
    this.renderer = new RendererService({
      createHost: () => new IframeRenderHost({
        iframeUrl: './iframe-render.html',
        source: 'mobile-parent',
      }),
      cache: this.cache,
      useRequestQueue: true,
    });
    
    this.i18n = new MobileI18nService();
    
    // Internal bridge reference
    this._bridge = bridge;
  }

  /**
   * Initialize all platform services
   */
  async init(): Promise<void> {
    await this.cache.init();
    await this.i18n.init();
  }

  /**
   * Notify host app that WebView is ready
   */
  notifyReady(): void {
    bridge.postMessage('WEBVIEW_READY', {});
  }

  /**
   * Request file download (triggers system share sheet)
   * @deprecated Use platform.file.download() instead
   */
  downloadFile(filename: string, data: string, mimeType: string): void {
    bridge.postMessage('DOWNLOAD_FILE', {
      filename,
      data, // base64 encoded
      mimeType
    });
  }
}

// ============================================================================
// Export
// ============================================================================

export const platform = new MobilePlatformAPI();

export {
  MobileResourceService,
  MobileMessageService,
  MobileI18nService,
  MobilePlatformAPI,
  DEFAULT_SETTING_LOCALE
};

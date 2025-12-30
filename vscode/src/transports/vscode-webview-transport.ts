/**
 * VSCodeWebviewTransport
 *
 * Raw transport for VS Code Webview communication.
 *
 * Webview -> Extension Host: vscode.postMessage(message)
 * Extension Host -> Webview: window.addEventListener('message', ...)
 */

import type { MessageTransport, TransportMeta, Unsubscribe } from '../../../src/messaging/transports/transport';

/**
 * VS Code API interface (available in webview via acquireVsCodeApi)
 */
interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

export class VSCodeWebviewTransport implements MessageTransport {
  private vscode: VSCodeAPI | null = null;

  constructor() {
    this.initVSCodeAPI();
  }

  private initVSCodeAPI(): void {
    if (typeof acquireVsCodeApi !== 'undefined') {
      this.vscode = acquireVsCodeApi();
    }
  }

  send(message: unknown): void {
    if (this.vscode) {
      this.vscode.postMessage(message);
      return;
    }
    console.warn('[VSCodeWebviewTransport] VS Code API not available');
  }

  onMessage(handler: (message: unknown, meta?: TransportMeta) => void): Unsubscribe {
    const listener = (event: MessageEvent) => {
      const meta: TransportMeta = {
        raw: event,
        respond: (response: unknown) => {
          this.send(response);
        },
      };
      handler(event.data, meta);
    };

    window.addEventListener('message', listener);

    return () => {
      window.removeEventListener('message', listener);
    };
  }

  /**
   * Get webview state (persisted across webview hide/show)
   */
  getState(): unknown {
    return this.vscode?.getState();
  }

  /**
   * Set webview state
   */
  setState(state: unknown): void {
    this.vscode?.setState(state);
  }
}

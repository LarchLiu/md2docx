/**
 * ChromeRuntimeTransport
 *
 * Raw transport for chrome.runtime messaging.
 */

import type { MessageTransport, TransportMeta, Unsubscribe } from '../../../src/messaging/transports/transport';

export class ChromeRuntimeTransport implements MessageTransport {
  private listener?: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void | boolean;

  send(message: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  onMessage(handler: (message: unknown, meta?: TransportMeta) => void): Unsubscribe {
    this.listener = (message, sender, _sendResponse) => {
      const meta: TransportMeta = {
        raw: sender,
        respond: _sendResponse,
      };
      handler(message, meta);
      return true;
    };

    chrome.runtime.onMessage.addListener(this.listener);

    return () => {
      if (this.listener) {
        chrome.runtime.onMessage.removeListener(this.listener);
        this.listener = undefined;
      }
    };
  }
}

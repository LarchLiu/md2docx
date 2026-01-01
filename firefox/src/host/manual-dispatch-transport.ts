/**
 * ManualDispatchTransport
 * 
 * A transport that doesn't set up its own onMessage listener.
 * Instead, messages are manually dispatched by the background's main listener.
 * This avoids conflicts with multiple listeners in Firefox MV2 background.
 */

import type { MessageTransport, TransportMeta, Unsubscribe } from '../../../src/messaging/transports/transport';

// Firefox WebExtension API types
declare const browser: typeof chrome;

type IncomingHandler = (message: unknown, meta?: TransportMeta) => void;

export class ManualDispatchTransport implements MessageTransport {
  private handler: IncomingHandler | null = null;

  async send(message: unknown): Promise<unknown> {
    // Send response via browser.runtime.sendMessage
    // This is typically used for sending responses back
    try {
      return await browser.runtime.sendMessage(message);
    } catch {
      // Ignore send errors - response might be sent via meta.respond
      return undefined;
    }
  }

  onMessage(handler: IncomingHandler): Unsubscribe {
    // Store the handler but don't add a browser listener
    // The main background listener will call dispatch() manually
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  /**
   * Manually dispatch a message to the registered handler.
   * Called by the main background message listener.
   * @param message - The incoming message
   * @param sendResponse - Function to send response back
   * @returns true if message was handled, false otherwise
   */
  dispatch(message: unknown, sendResponse: (response: unknown) => void): boolean {
    if (!this.handler) {
      return false;
    }

    const meta: TransportMeta = {
      respond: sendResponse,
    };

    this.handler(message, meta);
    return true;
  }
}

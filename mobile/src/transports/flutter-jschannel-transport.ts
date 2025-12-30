/**
 * FlutterJsChannelTransport
 *
 * Raw transport for Flutter WebView JavascriptChannel.
 *
 * JS -> Flutter: window.MarkdownViewer.postMessage(JSON.stringify(...))
 * Flutter -> JS: window.__receiveMessageFromHost(payload)
 */

import type { MessageTransport, TransportMeta, Unsubscribe } from '../../../src/messaging/transports/transport';

declare global {
  interface Window {
    MarkdownViewer?: {
      postMessage: (message: string) => void;
    };
    __receiveMessageFromHost?: (payload: unknown) => void;
  }
}

export class FlutterJsChannelTransport implements MessageTransport {
  send(message: unknown): void {
    const json = JSON.stringify(message);
    if (window.MarkdownViewer && typeof window.MarkdownViewer.postMessage === 'function') {
      window.MarkdownViewer.postMessage(json);
      return;
    }
    // Intentionally no throw to keep parity with current mobile behavior.
    // eslint-disable-next-line no-console
    console.warn('[FlutterJsChannelTransport] Host channel not available');
  }

  onMessage(handler: (message: unknown, meta?: TransportMeta) => void): Unsubscribe {
    const prev = window.__receiveMessageFromHost;

    const meta: TransportMeta = {
      raw: { source: 'flutter-host' },
      respond: (message: unknown) => {
        this.send(message);
      },
    };

    window.__receiveMessageFromHost = (payload: unknown) => {
      handler(payload, meta);
      prev?.(payload);
    };

    // Also accept window.postMessage-based delivery (debugging / tooling).
    const postMessageListener = (event: MessageEvent) => handler(event.data, { raw: event, respond: meta.respond });
    window.addEventListener('message', postMessageListener);

    return () => {
      window.removeEventListener('message', postMessageListener);
      // Restore previous handler.
      window.__receiveMessageFromHost = prev;
    };
  }
}

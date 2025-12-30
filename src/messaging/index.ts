/**
 * Messaging public exports
 */

export { BaseMessageChannel } from './base-channel';
export { ServiceChannel } from './channels/service-channel';
export { RenderChannel } from './channels/render-channel';

export { WindowPostMessageTransport } from './transports/window-postmessage-transport';
export { InProcessTransport } from './transports/in-process-transport';

export type { MessageTransport, TransportMeta, Unsubscribe } from './transports/transport';

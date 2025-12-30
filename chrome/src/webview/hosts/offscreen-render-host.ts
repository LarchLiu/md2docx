import type { RenderHost } from '../../../../src/renderers/host/render-host';

type OffscreenMessageService = {
  sendEnvelope: (
    type: string,
    payload: unknown,
    timeout?: number,
    source?: string
  ) => Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }>;
};

export class OffscreenRenderHost implements RenderHost {
  private messageService: OffscreenMessageService;
  private source: string;

  constructor(messageService: OffscreenMessageService, source: string) {
    this.messageService = messageService;
    this.source = source;
  }

  async ensureReady(): Promise<void> {
    // Offscreen readiness is ensured by background when it receives requests.
  }

  async send<T = unknown>(type: string, payload: unknown, timeoutMs: number = 300000): Promise<T> {
    const response = await this.messageService.sendEnvelope(type, payload, timeoutMs, this.source);
    if (!response.ok) {
      throw new Error(response.error?.message || `${type} failed`);
    }
    return response.data as T;
  }
}

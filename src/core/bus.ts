/**
 * 本地消息总线：基于同源 BroadcastChannel。
 * 不经过任何网络 / 在线服务，仅在同一浏览器配置内的页面间投递。
 */
import type { WireMessage } from './protocol';

export type MessageHandler = (message: WireMessage) => void;

export interface MessageBus {
  post(message: WireMessage): void;
  subscribe(handler: MessageHandler): () => void;
  close(): void;
}

export function createBroadcastBus(channel: string): MessageBus {
  const bc = new BroadcastChannel(channel);
  const handlers = new Set<MessageHandler>();

  bc.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as WireMessage;
    handlers.forEach((handler) => handler(message));
  };

  return {
    post(message) {
      bc.postMessage(message);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      handlers.clear();
      bc.close();
    },
  };
}

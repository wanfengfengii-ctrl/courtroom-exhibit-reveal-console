/**
 * 跨浏览上下文消息协议（控制台 ↔ 展示窗）。
 * 仅在同源的 BroadcastChannel 内传递，不访问任何在线服务。
 */

export interface Exhibit {
  id: string;
  title: string;
  body: string;
}

/** 控制台 → 展示窗：心跳探测 */
export interface PingMessage {
  type: 'ping';
  sessionId: string;
}

/** 展示窗 → 控制台：在线应答（心跳回复） */
export interface HelloMessage {
  type: 'hello';
  sessionId: string;
}

/** 展示窗 → 控制台：关闭前告知 */
export interface ByeMessage {
  type: 'bye';
  sessionId: string;
}

/** 控制台 → 展示窗：揭示某项证物（携带会话标识与严格递增序号） */
export interface RevealMessage {
  type: 'reveal';
  sessionId: string;
  seq: number;
  exhibit: Exhibit;
  at: number;
}

/** 展示窗 → 控制台：内容应用完成后回传同会话同序号确认 */
export interface AckMessage {
  type: 'ack';
  sessionId: string;
  seq: number;
}

export type WireMessage =
  | PingMessage
  | HelloMessage
  | ByeMessage
  | RevealMessage
  | AckMessage;

const PROTOCOL_VERSION = 1;

export function channelName(sessionId: string): string {
  return `reveal-bench-v${PROTOCOL_VERSION}-${sessionId}`;
}

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isRevealMessage(value: unknown): value is RevealMessage {
  if (!isObject(value) || value.type !== 'reveal') return false;
  if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq <= 0) {
    return false;
  }
  if (typeof value.at !== 'number') return false;
  const exhibit = value.exhibit;
  if (!isObject(exhibit)) return false;
  return (
    asString(exhibit.id) !== null &&
    asString(exhibit.title) !== null &&
    asString(exhibit.body) !== null
  );
}

export function isAckMessage(value: unknown): value is AckMessage {
  return (
    isObject(value) &&
    value.type === 'ack' &&
    asString(value.sessionId) !== null &&
    typeof value.seq === 'number' &&
    Number.isInteger(value.seq) &&
    value.seq > 0
  );
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  return isObject(value) && value.type === 'hello' && asString(value.sessionId) !== null;
}

export function isByeMessage(value: unknown): value is ByeMessage {
  return isObject(value) && value.type === 'bye' && asString(value.sessionId) !== null;
}

export function isPingFor(value: unknown, sessionId: string): value is PingMessage {
  return isObject(value) && value.type === 'ping' && value.sessionId === sessionId;
}

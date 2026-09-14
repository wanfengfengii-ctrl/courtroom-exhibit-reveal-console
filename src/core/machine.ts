/**
 * 值守控制台消息状态机（纯函数，无 DOM、无定时器，便于单测）。
 *
 * 不变量：
 *  - 每次揭示携带会话标识与会话内严格递增序号；
 *  - 只有收到同会话、同序号且当前仍在等待的确认，才标记成功；
 *  - 2 秒无确认 → 保持未确认（timeout），允许以新序号重试；
 *  - 旧序号 / 超时后 / 重复 / 异会话的确认，一律忽略并留下可观察记录。
 */
import type { Exhibit, RevealMessage } from './protocol';

export const ACK_TIMEOUT_MS = 2000;

export type RevealStatus = 'idle' | 'pending' | 'confirmed' | 'timeout';

export type IgnoredReason =
  | 'stale' // 序号小于当前揭示（重试后的旧确认）
  | 'late' // 同一项已超时，确认才到
  | 'duplicate' // 已经确认成功，重复确认
  | 'future' // 序号大于任何已发揭示
  | 'session'; // 会话不匹配

export interface IgnoredAck {
  seq: number;
  reason: IgnoredReason;
  at: number;
}

export interface CurrentReveal {
  exhibit: Exhibit;
  seq: number;
  status: RevealStatus;
  since: number;
}

export interface LogEntry {
  at: number;
  level: 'info' | 'warn';
  message: string;
}

export interface ConsoleState {
  sessionId: string;
  connected: boolean;
  exhibits: Exhibit[];
  loadErrors: string[] | null;
  /** 会话内已使用的最大序号，只增不减，保证严格递增且绝不复用。 */
  seq: number;
  current: CurrentReveal | null;
  /** 最近一次被屏蔽的迟到确认（用于界面醒目标注）。 */
  shielded: IgnoredAck | null;
  ignoredAcks: IgnoredAck[];
  log: LogEntry[];
}

export type ConsoleEvent =
  | { type: 'hello'; lastSeq: number; at: number }
  | { type: 'disconnected'; at: number }
  | { type: 'load'; exhibits: Exhibit[]; at: number }
  | { type: 'loadFailed'; errors: string[]; at: number }
  | { type: 'reveal'; exhibit: Exhibit; at: number }
  | { type: 'ack'; sessionId: string; seq: number; at: number }
  | { type: 'timeout'; seq: number; at: number };

export interface StepResult {
  state: ConsoleState;
  /** 本次迁移需要实际投递给展示窗的消息。 */
  send?: RevealMessage;
}

const MAX_LOG = 100;

function pushLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  const next = [...log, entry];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
}

export function initState(sessionId: string, initialSeq = 0): ConsoleState {
  return {
    sessionId,
    connected: false,
    exhibits: [],
    loadErrors: null,
    seq: initialSeq,
    current: null,
    shielded: null,
    ignoredAcks: [],
    log: [],
  };
}

/** 展示窗未连接，或当前揭示仍在等待确认时，不允许发出新揭示。 */
export function canReveal(state: ConsoleState): boolean {
  return state.connected && state.current?.status !== 'pending';
}

export function step(state: ConsoleState, event: ConsoleEvent): StepResult {
  switch (event.type) {
    case 'hello': {
      // 展示窗握手上报其已应用的最大序号：据此抬升本地序号基线，
      // 保证控制台刷新后绝不会发出展示窗视为“旧序号”的揭示。
      const seq = Math.max(state.seq, event.lastSeq);
      const seqBumped = seq > state.seq;
      if (state.connected && !seqBumped) return { state };
      return {
        state: {
          ...state,
          connected: true,
          seq,
          log: pushLog(state.log, {
            at: event.at,
            level: 'info',
            message: seqBumped
              ? `展示窗已连接，并将序号基线抬升至 #${seq}`
              : '展示窗已连接',
          }),
        },
      };
    }

    case 'disconnected': {
      if (!state.connected) return { state };
      return {
        state: {
          ...state,
          connected: false,
          log: pushLog(state.log, { at: event.at, level: 'warn', message: '展示窗连接断开' }),
        },
      };
    }

    case 'load': {
      // 序号不清零：同一会话内绝不复用旧序号，避免迟到确认错配到新清单。
      return {
        state: {
          ...state,
          exhibits: event.exhibits,
          loadErrors: null,
          current: null,
          shielded: null,
          log: pushLog(state.log, {
            at: event.at,
            level: 'info',
            message: `已载入 ${event.exhibits.length} 项证物`,
          }),
        },
      };
    }

    case 'loadFailed': {
      // 非法 JSON：整份拒绝并清空旧证物。
      return {
        state: {
          ...state,
          exhibits: [],
          loadErrors: event.errors,
          current: null,
          shielded: null,
          log: pushLog(state.log, {
            at: event.at,
            level: 'warn',
            message: `证物清单被整份拒绝（${event.errors.length} 个问题），已清空旧证物`,
          }),
        },
      };
    }

    case 'reveal': {
      // 硬守卫：未连接绝不发出揭示；等待确认期间也不接受新揭示。
      if (!state.connected || state.current?.status === 'pending') {
        return { state };
      }
      const seq = state.seq + 1;
      const message: RevealMessage = {
        type: 'reveal',
        sessionId: state.sessionId,
        seq,
        exhibit: event.exhibit,
        at: event.at,
      };
      return {
        state: {
          ...state,
          seq,
          current: { exhibit: event.exhibit, seq, status: 'pending', since: event.at },
          shielded: null,
          log: pushLog(state.log, {
            at: event.at,
            level: 'info',
            message: `发出揭示 #${seq}：${event.exhibit.id}（等待展示窗确认）`,
          }),
        },
        send: message,
      };
    }

    case 'timeout': {
      if (state.current?.seq !== event.seq || state.current.status !== 'pending') {
        return { state };
      }
      return {
        state: {
          ...state,
          current: { ...state.current, status: 'timeout' },
          log: pushLog(state.log, {
            at: event.at,
            level: 'warn',
            message: `#${event.seq} 超过 ${ACK_TIMEOUT_MS}ms 未收到确认，保持未确认，可重试（将使用新序号）`,
          }),
        },
      };
    }

    case 'ack': {
      if (event.sessionId !== state.sessionId) {
        return ignoreAck(state, event.seq, 'session', event.at, '会话标识不匹配');
      }
      const current = state.current;
      if (!current) {
        return ignoreAck(state, event.seq, 'future', event.at, '当前没有进行中的揭示');
      }
      if (event.seq < current.seq) {
        return ignoreAck(state, event.seq, 'stale', event.at, '旧序号确认（重试前的揭示）');
      }
      if (event.seq > current.seq) {
        return ignoreAck(state, event.seq, 'future', event.at, '序号大于当前揭示');
      }
      if (current.status === 'confirmed') {
        return ignoreAck(state, event.seq, 'duplicate', event.at, '重复确认');
      }
      if (current.status === 'timeout') {
        return ignoreAck(state, event.seq, 'late', event.at, '该序号已超时，确认迟到');
      }

      // 唯一的成功路径：同会话 + 同序号 + 仍在等待。
      return {
        state: {
          ...state,
          current: { ...current, status: 'confirmed' },
          log: pushLog(state.log, {
            at: event.at,
            level: 'info',
            message: `收到匹配确认 #${event.seq}，投影已同步`,
          }),
        },
      };
    }
  }
}

function ignoreAck(
  state: ConsoleState,
  seq: number,
  reason: IgnoredReason,
  at: number,
  detail: string,
): StepResult {
  const ignored: IgnoredAck = { seq, reason, at };
  return {
    state: {
      ...state,
      shielded: ignored,
      ignoredAcks: [...state.ignoredAcks, ignored],
      log: pushLog(state.log, {
        at,
        level: 'warn',
        message: `已屏蔽确认 #${seq}：${detail}`,
      }),
    },
  };
}

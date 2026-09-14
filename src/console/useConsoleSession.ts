import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ACK_TIMEOUT_MS,
  canReveal as canRevealState,
  initState,
  step,
  type ConsoleState,
} from '../core/machine';
import type { Exhibit } from '../core/protocol';
import { isAckMessage, isByeMessage, isHelloMessage } from '../core/protocol';
import type { MessageBus } from '../core/bus';
import { parseExhibitJson } from '../core/validate';

const PING_INTERVAL_MS = 600;
const HELLO_GRACE_MS = 1500;
const WATCHDOG_INTERVAL_MS = 400;

export interface ConsoleController {
  state: ConsoleState;
  openDisplay: () => void;
  reveal: (exhibit: Exhibit) => void;
  loadExhibitText: (text: string) => void;
}

export function useConsoleSession(bus: MessageBus, sessionId: string): ConsoleController {
  const [state, dispatch] = useReducer(
    (prev: ConsoleState, action: Parameters<typeof step>[1]) => step(prev, action).state,
    sessionId,
    initState,
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const ackTimerRef = useRef<number | null>(null);
  const lastHelloRef = useRef(0);

  const clearAckTimer = useCallback(() => {
    if (ackTimerRef.current !== null) {
      window.clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = bus.subscribe((message) => {
      const now = Date.now();
      if (isHelloMessage(message) && message.sessionId === sessionId) {
        lastHelloRef.current = now;
        if (!stateRef.current.connected) {
          dispatch({ type: 'connected', at: now });
        }
      } else if (isByeMessage(message) && message.sessionId === sessionId) {
        dispatch({ type: 'disconnected', at: now });
      } else if (isAckMessage(message)) {
        if (
          message.sessionId === sessionId &&
          stateRef.current.current?.seq === message.seq &&
          stateRef.current.current.status === 'pending'
        ) {
          clearAckTimer();
        }
        dispatch({ type: 'ack', sessionId: message.sessionId, seq: message.seq, at: now });
      }
    });
    return unsubscribe;
  }, [bus, sessionId, clearAckTimer]);

  // 心跳探测 + 看门狗：展示窗关闭后连接状态自动回落为未连接。
  useEffect(() => {
    const ping = window.setInterval(() => {
      bus.post({ type: 'ping', sessionId });
    }, PING_INTERVAL_MS);

    const watchdog = window.setInterval(() => {
      if (stateRef.current.connected && Date.now() - lastHelloRef.current > HELLO_GRACE_MS) {
        dispatch({ type: 'disconnected', at: Date.now() });
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      window.clearInterval(ping);
      window.clearInterval(watchdog);
    };
  }, [bus, sessionId]);

  useEffect(() => () => clearAckTimer(), [clearAckTimer]);

  const reveal = useCallback(
    (exhibit: Exhibit) => {
      if (!canRevealState(stateRef.current)) return; // 未连接 / 等待中：硬守卫
      const now = Date.now();
      const result = step(stateRef.current, { type: 'reveal', exhibit, at: now });
      if (!result.send) return;
      dispatch({ type: 'reveal', exhibit, at: now });
      bus.post(result.send);

      clearAckTimer();
      const seq = result.send.seq;
      ackTimerRef.current = window.setTimeout(() => {
        dispatch({ type: 'timeout', seq, at: Date.now() });
      }, ACK_TIMEOUT_MS);
    },
    [bus, clearAckTimer],
  );

  const openDisplay = useCallback(() => {
    const url = `${import.meta.env.BASE_URL}display.html?sid=${encodeURIComponent(sessionId)}`;
    window.open(url, 'reveal-display-window', 'popup=yes,width=960,height=720');
  }, [sessionId]);

  const loadExhibitText = useCallback((text: string) => {
    const parsed = parseExhibitJson(text);
    const at = Date.now();
    dispatch(
      parsed.ok
        ? { type: 'load', exhibits: parsed.exhibits, at }
        : { type: 'loadFailed', errors: parsed.errors, at },
    );
  }, []);

  return { state, openDisplay, reveal, loadExhibitText };
}

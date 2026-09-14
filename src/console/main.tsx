import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './ConsoleApp';
import { createBroadcastBus } from '../core/bus';
import { channelName, createSessionId } from '../core/protocol';
import '../styles.css';

// 会话标识存于 localStorage：控制台与同一浏览器配置内打开展示窗共享。
const STORAGE_KEY = 'reveal-bench.session-id';

function bootSessionId(): string {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = createSessionId();
  window.localStorage.setItem(STORAGE_KEY, created);
  return created;
}

const sessionId = bootSessionId();
const bus = createBroadcastBus(channelName(sessionId));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConsoleApp bus={bus} sessionId={sessionId} />
  </StrictMode>,
);

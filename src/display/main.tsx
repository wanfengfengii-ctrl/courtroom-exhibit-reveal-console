import { createRoot } from 'react-dom/client';
import { DisplayApp } from './DisplayApp';
import { createBroadcastBus } from '../core/bus';
import { channelName } from '../core/protocol';
import './display.css';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sid');

const rootEl = document.getElementById('root')!;

if (!sessionId) {
  rootEl.textContent = '展示窗缺少会话标识（sid），请由值守控制台打开。';
} else {
  const bus = createBroadcastBus(channelName(sessionId));
  createRoot(rootEl).render(<DisplayApp bus={bus} sessionId={sessionId} />);
}

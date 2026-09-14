import { useMemo, useState } from 'react';
import { useConsoleSession } from './useConsoleSession';
import type { MessageBus } from '../core/bus';
import type { Exhibit } from '../core/protocol';

const SAMPLE_JSON = `{
  "exhibits": [
    { "id": "EX-01", "title": "示例证物", "body": "在此粘贴或载入本地 JSON。" }
  ]
}`;

export function ConsoleApp({ bus, sessionId }: { bus: MessageBus; sessionId: string }) {
  const { state, openDisplay, reveal, loadExhibitText } = useConsoleSession(bus, sessionId);
  const [draft, setDraft] = useState(SAMPLE_JSON);
  const [fileName, setFileName] = useState<string | null>(null);

  const currentId = state.current?.exhibit.id ?? null;

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setDraft(text);
    setFileName(file.name);
    loadExhibitText(text);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>值守控制台 · 双屏证物揭示台</h1>
        <div className="sub">
          会话标识：<code>{sessionId}</code>　|　揭示均经本地 BroadcastChannel 投递，不调用任何在线服务
        </div>
      </header>

      <StatusBanner
        connected={state.connected}
        current={state.current}
        shielded={state.shielded}
        onRetry={() => state.current && reveal(state.current.exhibit)}
      />

      <div className="panels">
        <section className="panel">
          <h2>① 展示窗</h2>
          <p className="muted">
            <span className={`conn-dot ${state.connected ? 'on' : 'off'}`} />
            {state.connected ? '展示窗已连接，可以揭示' : '展示窗未连接：禁止发出揭示'}
          </p>
          <div className="row">
            <button className="btn" onClick={openDisplay} data-testid="open-display">
              打开投影展示窗
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>② 本地证物 JSON（根对象仅含 exhibits 数组，1–50 项）</h2>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            data-testid="json-input"
          />
          <div className="row">
            <button className="btn" onClick={() => loadExhibitText(draft)} data-testid="load-json">
              载入并整份校验
            </button>
            <label className="btn ghost">
              选择本地文件
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => void onPickFile(e.target.files?.[0])}
              />
            </label>
            {fileName && <span className="muted">当前文件：{fileName}</span>}
          </div>
          {state.loadErrors && (
            <div className="errors" data-testid="load-errors">
              <strong>非法 JSON，整份拒绝，旧证物已清空：</strong>
              <ul>
                {state.loadErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>③ 逐项揭示（{state.exhibits.length} 项）</h2>
          {state.exhibits.length === 0 ? (
            <p className="muted" data-testid="exhibit-empty">
              尚无可揭示证物，请先载入合法 JSON。
            </p>
          ) : null}
          <ul className="exhibit-list" data-testid="exhibit-list">
            {state.exhibits.map((exhibit: Exhibit) => (
                <li
                  key={exhibit.id}
                  className={`exhibit-item ${currentId === exhibit.id ? 'active' : ''}`}
                  data-testid={`exhibit-${exhibit.id}`}
                >
                  <div className="exhibit-meta">
                    <div className="exhibit-id">{exhibit.id}</div>
                    <div className="exhibit-title">{exhibit.title}</div>
                  </div>
                  <button
                    className="btn reveal-btn"
                    disabled={!state.connected || state.current?.status === 'pending'}
                    onClick={() => reveal(exhibit)}
                    data-exhibit-id={exhibit.id}
                  >
                    揭示
                  </button>
                </li>
              ))}
            </ul>
        </section>

        <section className="panel">
          <h2>④ 消息记录</h2>
          <div className="log">
            {state.log.length === 0 && <div className="muted">暂无消息。</div>}
            {state.log.map((entry, i) => (
              <div key={i} className={entry.level}>
                {new Date(entry.at).toLocaleTimeString()} · {entry.message}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type BannerProps = {
  connected: boolean;
  current: ReturnType<typeof useConsoleSession>['state']['current'];
  shielded: ReturnType<typeof useConsoleSession>['state']['shielded'];
  onRetry: () => void;
};

function StatusBanner({ connected, current, shielded, onRetry }: BannerProps) {
  // 唯一状态：迟到确认被屏蔽 / 已确认同步 / 未连接 / 等待确认 / 超时 / 就绪，互斥呈现。
  const view = useMemo(() => {
    if (shielded) {
      return {
        cls: 'shielded',
        big: '🛡️ 迟到确认已屏蔽',
        detail: `序号 #${shielded.seq} 的确认（${reasonText(shielded.reason)}）被可观察地忽略，不改变当前状态`,
        retry: current?.status === 'timeout',
      };
    }
    if (current?.status === 'confirmed') {
      return {
        cls: 'confirmed',
        big: '✅ 投影已同步',
        detail: `证物 ${current.exhibit.id}（序号 #${current.seq}）已收到展示窗同会话同序号确认`,
        retry: false,
      };
    }
    if (!connected) {
      return {
        cls: 'disconnected',
        big: '⛔ 展示窗未连接',
        detail: '禁止发出揭示；请先打开或检查投影展示窗',
        retry: false,
      };
    }
    if (current?.status === 'pending') {
      return {
        cls: 'pending',
        big: '⏳ 等待确认…',
        detail: `证物 ${current.exhibit.id}（序号 #${current.seq}）已发出，2 秒内未确认将转为超时`,
        retry: false,
      };
    }
    if (current?.status === 'timeout') {
      return {
        cls: 'timeout',
        big: '⚠️ 超时未确认（保持未确认）',
        detail: `序号 #${current.seq} 未在 2 秒内收到匹配确认；可用新序号重试`,
        retry: true,
      };
    }
    return { cls: '', big: '○ 就绪', detail: '展示窗已连接，等待值守员选择证物', retry: false };
  }, [connected, current, shielded]);

  return (
    <div className={`status-banner ${view.cls}`.trim()} data-testid="status-banner" data-status={view.cls || 'ready'}>
      <div>
        <div className="big">{view.big}</div>
        <div className="detail">{view.detail}</div>
      </div>
      <span style={{ flex: 1 }} />
      {view.retry && (
        <button className="btn" onClick={onRetry}>
          以新序号重试
        </button>
      )}
    </div>
  );
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'late':
      return '超时后迟到';
    case 'stale':
      return '属于已重试的旧序号';
    case 'duplicate':
      return '重复';
    case 'future':
      return '序号未知';
    case 'session':
      return '会话不匹配';
    default:
      return reason;
  }
}

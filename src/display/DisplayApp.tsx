import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { MessageBus } from '../core/bus';
import { isPingFor, isRevealMessage, type Exhibit } from '../core/protocol';

interface Shown {
  seq: number;
  exhibit: Exhibit;
}

export function DisplayApp({ bus, sessionId }: { bus: MessageBus; sessionId: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [peerSeq, setPeerSeq] = useState<number | null>(null);
  const appliedSeqRef = useRef(0);

  useEffect(() => {
    const sayHello = () =>
      bus.post({ type: 'hello', sessionId, lastSeq: appliedSeqRef.current });

    // 加载后立即报到，并响应每次心跳。
    sayHello();
    const heartbeat = window.setInterval(sayHello, 400);

    const unsubscribe = bus.subscribe((message) => {
      if (isPingFor(message, sessionId)) {
        sayHello();
        return;
      }

      if (isRevealMessage(message) && message.sessionId === sessionId) {
        // 只接受更新序号的揭示：严格递增，旧序号不能覆盖当前投影。
        if (message.seq <= appliedSeqRef.current) return;
        appliedSeqRef.current = message.seq;
        setPeerSeq(message.seq);

        // 先把内容真正应用到 DOM，再回传同会话同序号确认。
        flushSync(() => {
          setShown({ seq: message.seq, exhibit: message.exhibit });
        });
        bus.post({ type: 'ack', sessionId, seq: message.seq });
      }
    });

    const onUnload = () => bus.post({ type: 'bye', sessionId });
    window.addEventListener('pagehide', onUnload);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('pagehide', onUnload);
      unsubscribe();
    };
  }, [bus, sessionId]);

  return (
    <div className="display-stage">
      <div className="display-topline">
        投影展示窗　<span className="dim">会话 {sessionId.slice(0, 8)}…　序号 {peerSeq ?? '—'}</span>
      </div>
      {shown ? (
        <article key={shown.seq} className="display-exhibit" data-testid="shown-exhibit">
          <div className="display-id" data-testid="shown-id">
            {shown.exhibit.id}
          </div>
          <h1 className="display-title" data-testid="shown-title">
            {shown.exhibit.title}
          </h1>
          <p className="display-body" data-testid="shown-body">
            {shown.exhibit.body}
          </p>
        </article>
      ) : (
        <div className="display-empty" data-testid="display-empty">
          尚无已确认的当前证物
        </div>
      )}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { ACK_TIMEOUT_MS, canReveal, initState, step } from '../src/core/machine';
import type { Exhibit } from '../src/core/protocol';

const ex = (id: string): Exhibit => ({ id, title: `证物 ${id}`, body: `正文 ${id}` });
const T = 1000;

function connectedSession() {
  return step(initState('sess-A'), { type: 'hello', lastSeq: 0, at: T }).state;
}

function loaded(state = connectedSession(), items = ['A', 'B']) {
  return step(state, {
    type: 'load',
    exhibits: items.map(ex),
    at: T,
  }).state;
}

describe('连接守卫', () => {
  it('展示窗未连接时禁止发出揭示，且不产生消息', () => {
    const state = loaded(initState('sess-A'));
    expect(canReveal(state)).toBe(false);
    const result = step(state, { type: 'reveal', exhibit: ex('A'), at: T });
    expect(result.send).toBeUndefined();
    expect(result.state.current).toBeNull();
    expect(result.state.seq).toBe(0);
  });

  it('连接后允许揭示，断开后再次禁止', () => {
    let state = loaded();
    expect(canReveal(state)).toBe(true);
    state = step(state, { type: 'disconnected', at: T }).state;
    expect(canReveal(state)).toBe(false);
  });

  it('控制台刷新后序号不复位：hello 以展示窗已应用序号抬升基线，下一次揭示严格更大', () => {
    // 模拟刷新后内存序号归零、但展示窗保持打开且已应用 #3
    const fresh = initState('sess-A');
    const greeted = step(fresh, { type: 'hello', lastSeq: 3, at: T }).state;
    expect(greeted.connected).toBe(true);
    expect(greeted.seq).toBe(3);

    const reveal = step(greeted, { type: 'reveal', exhibit: ex('A'), at: T + 10 });
    expect(reveal.send?.seq).toBe(4);

    // 本地持久化基线高于展示窗上报时不回退
    const persisted = step(initState('sess-A', 5), { type: 'hello', lastSeq: 3, at: T }).state;
    expect(persisted.seq).toBe(5);
  });
});

describe('序号与确认', () => {
  it('每次揭示携带会话标识与严格递增序号', () => {
    let state = loaded();
    const r1 = step(state, { type: 'reveal', exhibit: ex('A'), at: T });
    expect(r1.send).toMatchObject({ sessionId: 'sess-A', seq: 1, exhibit: ex('A') });
    state = r1.state;

    // 等待确认期间不能发下一项
    const blocked = step(state, { type: 'reveal', exhibit: ex('B'), at: T + 10 });
    expect(blocked.send).toBeUndefined();

    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 100 }).state;
    expect(state.current?.status).toBe('confirmed');

    const r2 = step(state, { type: 'reveal', exhibit: ex('B'), at: T + 200 });
    expect(r2.send?.seq).toBe(2);
  });

  it('只有同会话同序号确认才标记成功', () => {
    let state = step(loaded(), { type: 'reveal', exhibit: ex('A'), at: T }).state;

    const wrongSession = step(state, {
      type: 'ack',
      sessionId: 'sess-OTHER',
      seq: 1,
      at: T + 50,
    }).state;
    expect(wrongSession.current?.status).toBe('pending');
    expect(wrongSession.ignoredAcks.at(-1)?.reason).toBe('session');

    const wrongSeq = step(state, { type: 'ack', sessionId: 'sess-A', seq: 9, at: T + 50 }).state;
    expect(wrongSeq.current?.status).toBe('pending');
    expect(wrongSeq.ignoredAcks.at(-1)?.reason).toBe('future');

    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 80 }).state;
    expect(state.current?.status).toBe('confirmed');

    // 重复确认被忽略
    const dup = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 90 }).state;
    expect(dup.current?.status).toBe('confirmed');
    expect(dup.ignoredAcks.at(-1)?.reason).toBe('duplicate');
  });
});

describe('超时、重试与迟到确认', () => {
  it('超时事件在 2 秒到来时保持未确认（timeout）而非成功', () => {
    let state = step(loaded(), { type: 'reveal', exhibit: ex('A'), at: T }).state;
    expect(state.current?.status).toBe('pending');

    // 2 秒整：定时器按 ACK_TIMEOUT_MS 触发
    state = step(state, { type: 'timeout', seq: 1, at: T + ACK_TIMEOUT_MS }).state;
    expect(state.current?.status).toBe('timeout');
    expect(canReveal(state)).toBe(true); // 允许重试
  });

  it('重试使用新序号，旧序号确认随后到达被标记为 stale 并忽略', () => {
    let state = step(loaded(), { type: 'reveal', exhibit: ex('A'), at: T }).state;
    state = step(state, { type: 'timeout', seq: 1, at: T + ACK_TIMEOUT_MS }).state;

    // 旧确认在重试前迟到 → late（同序号已超时）
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 2500 }).state;
    expect(state.current?.status).toBe('timeout');
    expect(state.shielded).toMatchObject({ seq: 1, reason: 'late' });

    // 重试 → 新序号 #2
    const retry = step(state, { type: 'reveal', exhibit: ex('A'), at: T + 3000 });
    expect(retry.send?.seq).toBe(2);
    state = retry.state;
    expect(state.current?.status).toBe('pending');

    // #1 的确认此时才到 → stale，绝不能把 #2 标成成功
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 3100 }).state;
    expect(state.current?.status).toBe('pending');
    expect(state.shielded).toMatchObject({ seq: 1, reason: 'stale' });

    // #2 正常确认
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 2, at: T + 3200 }).state;
    expect(state.current?.status).toBe('confirmed');
  });

  it('迟到确认不会把下一项误标为已展示：#2 超时后切到 #3，#2 的 ack 被屏蔽', () => {
    let state = loaded(connectedSession(), ['A', 'B']);
    state = step(state, { type: 'reveal', exhibit: ex('A'), at: 0 }).state;
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: 10 }).state;

    state = step(state, { type: 'reveal', exhibit: ex('B'), at: 20 }).state; // seq 2
    state = step(state, { type: 'timeout', seq: 2, at: 20 + ACK_TIMEOUT_MS }).state;
    state = step(state, { type: 'reveal', exhibit: ex('B'), at: 5000 }).state; // 重试 seq 3

    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 2, at: 5100 }).state;
    expect(state.current?.seq).toBe(3);
    expect(state.current?.status).toBe('pending');
    expect(state.shielded?.reason).toBe('stale');

    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 3, at: 5200 }).state;
    expect(state.current?.status).toBe('confirmed');
  });

  it('已确认的揭示不会被迟到的超时事件改回 timeout', () => {
    let state = step(loaded(), { type: 'reveal', exhibit: ex('A'), at: T }).state;
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 100 }).state;
    state = step(state, { type: 'timeout', seq: 1, at: T + 5000 }).state;
    expect(state.current?.status).toBe('confirmed');
  });
});

describe('证物载入', () => {
  it('合法清单整体载入', () => {
    const state = step(connectedSession(), {
      type: 'load',
      exhibits: [ex('A'), ex('B')],
      at: T,
    }).state;
    expect(state.exhibits).toHaveLength(2);
    expect(state.loadErrors).toBeNull();
  });

  it('非法载入整份拒绝并清空旧证物', () => {
    let state = loaded();
    expect(state.exhibits.length).toBeGreaterThan(0);
    state = step(state, {
      type: 'loadFailed',
      errors: ['JSON 解析失败'],
      at: T + 10,
    }).state;
    expect(state.exhibits).toEqual([]);
    expect(state.loadErrors).toEqual(['JSON 解析失败']);
    expect(state.current).toBeNull();
  });

  it('重新载入清单不复用旧序号', () => {
    let state = loaded();
    state = step(state, { type: 'reveal', exhibit: ex('A'), at: T }).state;
    state = step(state, { type: 'ack', sessionId: 'sess-A', seq: 1, at: T + 10 }).state;
    state = step(state, { type: 'load', exhibits: [ex('C')], at: T + 20 }).state;
    const next = step(state, { type: 'reveal', exhibit: ex('C'), at: T + 30 });
    expect(next.send?.seq).toBe(2);
  });
});

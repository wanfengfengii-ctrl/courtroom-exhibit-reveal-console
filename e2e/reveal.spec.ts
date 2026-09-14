import { expect, test, type Page } from '@playwright/test';

const VALID_JSON = JSON.stringify(
  {
    exhibits: [
      { id: 'EX-01', title: '合同书原件', body: '第一条……本件由双方当庭出示。' },
      { id: 'EX-02', title: '现场照片', body: '拍摄于当日 09:12，含时间戳。' },
    ],
  },
  null,
  2,
);

async function getSessionId(consolePage: Page): Promise<string> {
  const sid = await consolePage.evaluate(() =>
    window.localStorage.getItem('reveal-bench.session-id'),
  );
  if (!sid) throw new Error('控制台尚未生成会话标识');
  return sid;
}

async function openConsole(page: Page): Promise<void> {
  await page.goto('/console.html');
  await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'disconnected');
}

async function openDisplay(context: import('@playwright/test').BrowserContext, sid: string): Promise<Page> {
  const display = await context.newPage();
  await display.goto(`/display.html?sid=${encodeURIComponent(sid)}`);
  return display;
}

async function loadJson(consolePage: Page, text: string): Promise<void> {
  await consolePage.getByTestId('json-input').fill(text);
  await consolePage.getByTestId('load-json').click();
}

async function status(consolePage: Page) {
  return consolePage.getByTestId('status-banner').getAttribute('data-status');
}

async function openInjector(context: import('@playwright/test').BrowserContext): Promise<Page> {
  // 不同 sid 的展示页：自身频道隔离，仅借其浏览上下文向真实频道注入消息。
  const injector = await context.newPage();
  await injector.goto('/display.html?sid=injector-context');
  await injector.waitForLoadState();
  return injector;
}

async function postAck(page: Page, sid: string, seq: number): Promise<void> {
  await page.evaluate(
    ({ sid, seq }) => {
      const ch = new BroadcastChannel(`reveal-bench-v1-${sid}`);
      ch.postMessage({ type: 'ack', sessionId: sid, seq });
      ch.close();
    },
    { sid, seq },
  );
}

test.describe('双屏揭示台验收（两个浏览上下文）', () => {
  test('展示窗未连接时禁止揭示；由控制台按钮可打开展示窗并连通', async ({ page, context }) => {
    await openConsole(page);
    // 未连接：所有揭示动作不可用
    await expect(page.getByRole('button', { name: '揭示' })).toHaveCount(0);

    // 控制台主动打开展示窗（弹窗为同配置的第二个浏览上下文）
    const popupPromise = context.waitForEvent('page');
    await page.getByTestId('open-display').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'ready', {
      timeout: 5000,
    });
    await popup.close();
  });

  test('合法 JSON 载入后逐项揭示：展示窗先应用内容，控制台收到匹配确认才标记已同步', async ({
    page,
    context,
  }) => {
    await openConsole(page);
    const sid = await getSessionId(page);
    const display = await openDisplay(context, sid);
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'ready');

    await loadJson(page, VALID_JSON);
    await expect(page.getByTestId('exhibit-EX-01')).toBeVisible();
    await expect(page.getByTestId('exhibit-EX-02')).toBeVisible();

    // 让展示窗的确认延迟 300ms 回传（内容仍立即应用），以确定性观察“等待确认”态。
    await display.evaluate(() => {
      const orig = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (msg: unknown) {
        if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ack') {
          window.setTimeout(() => orig.call(this, msg), 300);
          return;
        }
        return orig.call(this, msg);
      };
    });

    // 发出揭示后立即进入“等待确认”，而不是口头假定成功
    await page.getByTestId('exhibit-EX-01').getByRole('button', { name: '揭示' }).click();
    expect(await status(page)).toBe('pending');
    expect(await page.getByTestId('status-banner').innerText()).toContain('#1');

    // 展示窗只呈现已确认应用的当前证物（内容先于确认上屏）
    await expect(display.getByTestId('shown-id')).toHaveText('EX-01');
    await expect(display.getByTestId('shown-title')).toHaveText('合同书原件');
    await expect(display.getByTestId('shown-body')).toContainText('第一条');
    expect(await status(page)).toBe('pending');

    // 同会话同序号确认到达 → 唯一状态：投影已同步
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'confirmed');
    await expect(page.getByTestId('status-banner')).toContainText('投影已同步');

    // 第二项使用严格递增的 #2
    await page.getByTestId('exhibit-EX-02').getByRole('button', { name: '揭示' }).click();
    expect(await status(page)).toBe('pending');
    await expect(display.getByTestId('shown-id')).toHaveText('EX-02');
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'confirmed');
    expect(await page.getByTestId('status-banner').innerText()).toContain('#2');
  });

  test('两秒无确认保持未确认；重试使用新序号；迟到的旧确认可观察地被屏蔽', async ({
    page,
    context,
  }) => {
    await openConsole(page);
    const sid = await getSessionId(page);
    const display = await openDisplay(context, sid);
    const injector = await openInjector(context);
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'ready');
    await loadJson(page, VALID_JSON);

    // 在展示窗侧吞掉 ack：内容仍应用，但确认永不回传
    await display.evaluate(() => {
      const orig = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (msg: unknown) {
        if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ack') return;
        return orig.call(this, msg);
      };
    });

    await page.getByTestId('exhibit-EX-01').getByRole('button', { name: '揭示' }).click();
    expect(await status(page)).toBe('pending');
    // 内容确实已上屏
    await expect(display.getByTestId('shown-id')).toHaveText('EX-01');

    // 2 秒无确认 → 超时，状态仍为未确认并提供重试
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'timeout', {
      timeout: 5000,
    });
    await expect(page.getByTestId('status-banner')).toContainText('超时未确认');

    // 超时后 #1 的确认才迟到（由第三个上下文注入）→ 被屏蔽，状态不得翻成成功
    await postAck(injector, sid, 1);
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'shielded');
    await expect(page.getByTestId('status-banner')).toContainText('#1');
    await expect(page.getByTestId('status-banner').getByRole('button', { name: '以新序号重试' })).toBeVisible();

    // 恢复确认通道并重试：必须使用新序号 #2
    await display.evaluate(() => {
      // 刷新页面以恢复原生 postMessage，再重新应用当前投影
      location.reload();
    });
    await display.waitForLoadState('load');
    await expect(display.getByTestId('display-empty')).toBeVisible();

    await page.getByRole('button', { name: '以新序号重试' }).click();
    expect(await status(page)).toBe('pending');
    await expect(page.getByTestId('status-banner')).toContainText('#2');
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'confirmed');

    // 重试成功后，#1 的旧确认再次到达仍被可观察忽略，不得污染 #2 的成功
    await postAck(injector, sid, 1);
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'shielded');
    await expect(page.getByTestId('status-banner')).toContainText('旧序号');
    // 展示窗内容未被旧消息改动
    await expect(display.getByTestId('shown-id')).toHaveText('EX-01');
  });

  test('非法 JSON 整份拒绝并清空旧证物', async ({ page, context }) => {
    await openConsole(page);
    const sid = await getSessionId(page);
    await openDisplay(context, sid);
    await loadJson(page, VALID_JSON);
    await expect(page.getByTestId('exhibit-EX-01')).toBeVisible();

    // 语法错误
    await loadJson(page, '{ "exhibits": [ } ');
    await expect(page.getByTestId('load-errors')).toBeVisible();
    await expect(page.getByTestId('load-errors')).toContainText('JSON 解析失败');
    await expect(page.getByTestId('exhibit-list')).toBeEmpty();

    // 语法合法但不符合契约：同样整份拒绝
    await loadJson(page, JSON.stringify({ exhibits: [{ id: 'X', title: '' }] }));
    await expect(page.getByTestId('load-errors')).toContainText('body 必须为非空字符串');
    await expect(page.getByTestId('exhibit-list')).toBeEmpty();
  });

  test('展示窗关闭后控制台回到未连接，禁止继续揭示', async ({ page, context }) => {
    await openConsole(page);
    const sid = await getSessionId(page);
    const display = await openDisplay(context, sid);
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'ready');
    await display.close();
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-status', 'disconnected', {
      timeout: 5000,
    });
  });
});

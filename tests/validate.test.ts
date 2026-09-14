import { describe, expect, it } from 'vitest';
import { parseExhibitJson, validateExhibits } from '../src/core/validate';

const valid = (id: string) => ({ id, title: `t-${id}`, body: `b-${id}` });

describe('validateExhibits', () => {
  it('接受合法清单（1–50 项）', () => {
    expect(validateExhibits({ exhibits: [valid('A')] }).ok).toBe(true);
    const fifty = { exhibits: Array.from({ length: 50 }, (_, i) => valid(`E${i}`)) };
    expect(validateExhibits(fifty).ok).toBe(true);
  });

  it('根对象必须仅含 exhibits 字段', () => {
    expect(validateExhibits({ exhibits: [], extra: 1 }).ok).toBe(false);
    expect(validateExhibits([]).ok).toBe(false);
    expect(validateExhibits(null).ok).toBe(false);
    expect(validateExhibits('x').ok).toBe(false);
  });

  it('数组长度越界整份拒绝（0 项与 51 项）', () => {
    expect(validateExhibits({ exhibits: [] }).ok).toBe(false);
    const tooMany = { exhibits: Array.from({ length: 51 }, (_, i) => valid(`E${i}`)) };
    const result = validateExhibits(tooMany);
    expect(result.ok).toBe(false);
  });

  it('id/title/body 必须为非空字符串（含纯空白）', () => {
    const cases = [
      { id: '', title: 't', body: 'b' },
      { id: 'x', title: '   ', body: 'b' },
      { id: 'x', title: 't', body: null },
      { id: 1, title: 't', body: 'b' },
      { title: 't', body: 'b' },
    ];
    for (const c of cases) {
      expect(validateExhibits({ exhibits: [c] }).ok).toBe(false);
    }
  });

  it('id 区分大小写：A 与 a 不重复；完全相同才重复', () => {
    expect(validateExhibits({ exhibits: [valid('A'), valid('a')] }).ok).toBe(true);
    const dup = validateExhibits({ exhibits: [valid('X'), valid('X')] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join(' ')).toContain('重复');
  });

  it('非法 JSON 文本整份拒绝并报告解析错误', () => {
    const result = parseExhibitJson('{ exhibits: [');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('JSON 解析失败');
  });
});

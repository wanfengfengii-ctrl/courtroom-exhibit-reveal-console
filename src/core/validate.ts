/** 本地 JSON 证物清单校验：整份通过或整份拒绝。 */
import type { Exhibit } from './protocol';

export type ValidationResult =
  | { ok: true; exhibits: Exhibit[] }
  | { ok: false; errors: string[] };

export const MIN_EXHIBITS = 1;
export const MAX_EXHIBITS = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateExhibits(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['根必须是对象，且仅含 exhibits 数组'] };
  }

  const rootKeys = Object.keys(input);
  if (rootKeys.length !== 1 || !('exhibits' in input)) {
    return {
      ok: false,
      errors: ["根对象仅允许包含 exhibits 一个字段（数组）"],
    };
  }

  const exhibits = input.exhibits;
  if (!Array.isArray(exhibits)) {
    return { ok: false, errors: ['exhibits 必须是数组'] };
  }

  if (exhibits.length < MIN_EXHIBITS || exhibits.length > MAX_EXHIBITS) {
    errors.push(`exhibits 数组长度必须为 ${MIN_EXHIBITS} 至 ${MAX_EXHIBITS}，当前为 ${exhibits.length}`);
  }

  const seen = new Set<string>();
  exhibits.forEach((raw, index) => {
    const label = `第 ${index + 1} 项`;
    if (!isPlainObject(raw)) {
      errors.push(`${label}：必须是对象`);
      return;
    }
    for (const field of ['id', 'title', 'body'] as const) {
      if (!nonEmptyString(raw[field])) {
        errors.push(`${label}：${field} 必须为非空字符串`);
      }
    }
    const id = raw.id;
    if (nonEmptyString(id)) {
      // Set 按原始字符串区分大小写：'A' 与 'a' 视为不同 id
      if (seen.has(id)) {
        errors.push(`${label}：id「${id}」重复（id 区分大小写，不得重复）`);
      } else {
        seen.add(id);
      }
    }
  });

  return errors.length === 0
    ? { ok: true, exhibits: exhibits as Exhibit[] }
    : { ok: false, errors };
}

/** 解析并整份校验本地 JSON 文本；解析失败同样整份拒绝。 */
export function parseExhibitJson(text: string): ValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`JSON 解析失败：${message}`] };
  }
  return validateExhibits(value);
}

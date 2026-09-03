import { isRecord } from './type-guards';

export type AuditHighlightSegment = {
  text: string;
  emphasize: boolean;
};

export function joinHighlightText(segments: readonly AuditHighlightSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

export function emphasizedTexts(segments: readonly AuditHighlightSegment[]): string[] {
  return segments.filter((segment) => segment.emphasize).map((segment) => segment.text);
}

/** Pretty-printed JSON with changed keys and values marked for bold rendering. */
export function highlightAuditJson(options: {
  value: Record<string, unknown>;
  counterpart?: Record<string, unknown> | null;
  changedFields?: readonly string[] | null;
}): AuditHighlightSegment[] {
  const { value, counterpart, changedFields } = options;
  const segments: AuditHighlightSegment[] = [];
  if (!counterpart) {
    append(segments, JSON.stringify(value, null, 2), false);
    return segments;
  }
  const changedKeys = changedFields?.length ? new Set(changedFields) : null;
  collectObject(segments, value, counterpart, '', changedKeys);
  return segments;
}

function append(segments: AuditHighlightSegment[], text: string, emphasize: boolean): void {
  if (!text) {
    return;
  }
  const last = segments[segments.length - 1];
  if (last && last.emphasize === emphasize) {
    last.text += text;
    return;
  }
  segments.push({ text, emphasize });
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => valuesEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(right, key) && valuesEqual(left[key], right[key])
  );
}

function serializePretty(value: unknown, indent: string): string {
  const normalized = value === undefined ? null : value;
  const raw = JSON.stringify(normalized, null, 2);
  if (raw === undefined) {
    return 'null';
  }
  return raw.includes('\n') ? raw.replace(/\n/g, `\n${indent}`) : raw;
}

function collectValue(
  segments: AuditHighlightSegment[],
  value: unknown,
  counterpart: unknown,
  indent: string
): void {
  if (isRecord(value) && isRecord(counterpart)) {
    collectObject(segments, value, counterpart, indent, null);
    return;
  }
  if (Array.isArray(value) && Array.isArray(counterpart)) {
    collectArray(segments, value, counterpart, indent);
    return;
  }
  if (typeof value === 'string' && typeof counterpart === 'string' && value !== counterpart) {
    collectChangedString(segments, value, counterpart);
    return;
  }
  append(segments, serializePretty(value, indent), !valuesEqual(value, counterpart));
}

function collectChangedString(segments: AuditHighlightSegment[], current: string, other: string): void {
  const currentTokens = tokenize(current);
  const otherTokens = tokenize(other);
  const { prefixCount, suffixCount } = sharedAffixCounts(currentTokens, otherTokens);
  const currentMid = currentTokens.slice(prefixCount, currentTokens.length - suffixCount);
  const otherMid = otherTokens.slice(prefixCount, otherTokens.length - suffixCount);
  if (currentMid.length === 0 || otherMid.length === 0) {
    append(segments, JSON.stringify(current), true);
    return;
  }
  append(segments, '"', false);
  append(segments, escapeJsonStringContent(currentTokens.slice(0, prefixCount).join('')), false);
  append(segments, escapeJsonStringContent(currentMid.join('')), true);
  const suffixTokens = currentTokens.slice(currentTokens.length - suffixCount);
  append(segments, escapeJsonStringContent(suffixTokens.join('')), false);
  append(segments, '"', false);
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part.length > 0);
}

function sharedAffixCounts(
  left: readonly string[],
  right: readonly string[]
): { prefixCount: number; suffixCount: number } {
  let prefixCount = 0;
  const maxPrefix = Math.min(left.length, right.length);
  while (prefixCount < maxPrefix && left[prefixCount] === right[prefixCount]) {
    prefixCount += 1;
  }
  let suffixCount = 0;
  const maxSuffix = Math.min(left.length - prefixCount, right.length - prefixCount);
  while (
    suffixCount < maxSuffix &&
    left[left.length - 1 - suffixCount] === right[right.length - 1 - suffixCount]
  ) {
    suffixCount += 1;
  }
  return { prefixCount, suffixCount };
}

function escapeJsonStringContent(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

function collectObject(
  segments: AuditHighlightSegment[],
  value: Record<string, unknown>,
  counterpart: Record<string, unknown>,
  indent: string,
  changedTopLevelKeys: ReadonlySet<string> | null
): void {
  const keys = Object.keys(value);
  append(segments, '{', false);
  if (keys.length === 0) {
    append(segments, '}', false);
    return;
  }
  append(segments, '\n', false);
  const inner = `${indent}  `;
  keys.forEach((key, index) => {
    const child = value[key];
    const hasOther = Object.prototype.hasOwnProperty.call(counterpart, key);
    const otherChild = hasOther ? counterpart[key] : undefined;
    const listed = changedTopLevelKeys?.has(key) === true;
    const equal = hasOther && valuesEqual(child, otherChild);
    append(segments, inner, false);
    append(segments, JSON.stringify(key), listed || !hasOther || !equal);
    append(segments, ': ', false);
    if (!hasOther || (listed && equal)) {
      append(segments, serializePretty(child, inner), true);
    } else {
      collectValue(segments, child, otherChild, inner);
    }
    if (index < keys.length - 1) {
      append(segments, ',', false);
    }
    append(segments, '\n', false);
  });
  append(segments, `${indent}}`, false);
}

function collectArray(
  segments: AuditHighlightSegment[],
  value: unknown[],
  counterpart: unknown[],
  indent: string
): void {
  append(segments, '[', false);
  if (value.length === 0) {
    append(segments, ']', false);
    return;
  }
  append(segments, '\n', false);
  const inner = `${indent}  `;
  value.forEach((child, index) => {
    const hasOther = index < counterpart.length;
    append(segments, inner, false);
    if (!hasOther) {
      append(segments, serializePretty(child, inner), true);
    } else {
      collectValue(segments, child, counterpart[index], inner);
    }
    if (index < value.length - 1) {
      append(segments, ',', false);
    }
    append(segments, '\n', false);
  });
  append(segments, `${indent}]`, false);
}

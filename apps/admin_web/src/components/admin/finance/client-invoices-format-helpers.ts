import { formatEnumLabel } from '@/lib/format';

export function formatTruncatedId(id: string | null | undefined): string {
  if (!id) {
    return '—';
  }
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}…`;
}

/** Customer payments Method column: snake_case label with FPS acronym spelled out. */
export function formatPaymentMethodLabel(
  raw: string | null | undefined,
): string {
  return formatEnumLabel(raw ?? '').replace(/\bFps\b/g, 'FPS');
}

import { Fragment } from 'react';

import { highlightAuditJson } from '@/lib/audit-value-highlight';

export function AuditHighlightedJson({
  value,
  counterpart,
  changedFields,
  className,
  'aria-label': ariaLabel,
}: {
  value: Record<string, unknown>;
  counterpart?: Record<string, unknown> | null;
  changedFields?: readonly string[] | null;
  className: string;
  'aria-label': string;
}) {
  const segments = highlightAuditJson({ value, counterpart, changedFields });
  return (
    <pre className={className} aria-label={ariaLabel}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.emphasize ? <strong className='font-bold'>{segment.text}</strong> : segment.text}
        </Fragment>
      ))}
    </pre>
  );
}

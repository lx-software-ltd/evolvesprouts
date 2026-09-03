import { useId, type ReactNode } from 'react';

import { clsx } from 'clsx';

export type DashboardCardWidth = 'half' | 'full';

/**
 * Lightweight dashboard grid tile. Unlike the table-first CRUD primitives (`AdminRecordTable`,
 * `AdminEditorPanel`), this only handles width spanning on the dashboard grid and a titled
 * `<section>` shell with `aria-labelledby` for landmark accessibility (dashboard metrics, not CRUD).
 */
export function DashboardCard({
  width,
  title,
  titleId: titleIdProp,
  children,
  className,
}: {
  width: DashboardCardWidth;
  title: string;
  /** Optional stable id for the title heading (defaults to `useId()`). */
  titleId?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;

  return (
    <section
      aria-labelledby={titleId}
      className={clsx(
        'rounded-xl border border-slate-200 bg-white p-4 shadow-sm',
        width === 'full' ? 'lg:col-span-2' : undefined,
        className,
      )}
    >
      <h2 id={titleId} className='text-sm font-semibold text-slate-900'>
        {title}
      </h2>
      <div className='mt-4'>{children}</div>
    </section>
  );
}

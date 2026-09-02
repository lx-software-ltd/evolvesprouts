import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/** White bordered box used for every admin content block (with or without a title). */
export function Card({
  title,
  description,
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <section
      {...rest}
      className={clsx(
        'rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:rounded-xl sm:p-6',
        className
      )}
    >
      {(title || description) && (
        <header className='mb-3 sm:mb-4'>
          {title && <h2 className='text-base font-semibold sm:text-lg'>{title}</h2>}
          {description && (
            <p className='mt-1 text-xs text-slate-600 sm:text-sm'>{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

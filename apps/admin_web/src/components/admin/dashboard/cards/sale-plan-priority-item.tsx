'use client';

import { useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import type {
  SalesDailyPlanFeedback,
  SalesDailyPlanPriority,
  SalesDailyPlanSnooze,
} from '@/types/sales-daily-plan';
import { salesInboxHref } from '@/types/sales-daily-plan';

const KIND_LABELS: Record<string, string> = {
  reply: 'Reply',
  close: 'Close',
  chase_payment: 'Chase payment',
  book: 'Book',
  offer: 'Offer',
};

const KIND_CLASS: Record<string, string> = {
  reply: 'bg-sky-50 text-sky-800',
  close: 'bg-emerald-50 text-emerald-800',
  chase_payment: 'bg-amber-50 text-amber-800',
  book: 'bg-violet-50 text-violet-800',
  offer: 'bg-slate-100 text-slate-700',
};

const URGENCY_LABELS: Record<number, string> = {
  1: 'High',
  2: 'Medium',
  3: 'Low',
};

function LeadLink({ leadId }: { leadId: string | null }) {
  if (!leadId) {
    return null;
  }
  return (
    <Link
      href={`/sales?lead=${encodeURIComponent(leadId)}`}
      className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
    >
      Open lead
    </Link>
  );
}

function InvoiceLink({ invoiceId }: { invoiceId: string | null }) {
  if (!invoiceId) {
    return null;
  }
  return (
    <Link
      href={`/finance?tab=client-invoices&invoice=${encodeURIComponent(invoiceId)}`}
      className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
    >
      Open invoice
    </Link>
  );
}

export function SalePlanPriorityItem({
  item,
  disabled,
  showCompare,
  onDoneChange,
  onFeedback,
  onSnooze,
}: {
  item: SalesDailyPlanPriority;
  disabled: boolean;
  showCompare: boolean;
  onDoneChange: (item: SalesDailyPlanPriority, done: boolean) => void;
  onFeedback: (item: SalesDailyPlanPriority, feedback: SalesDailyPlanFeedback | null) => void;
  onSnooze: (item: SalesDailyPlanPriority, snooze: SalesDailyPlanSnooze) => void;
}) {
  const checkboxId = `insight-priority-${item.itemKey}`;
  const inboxHref = salesInboxHref(item.channel ?? '', item.conversationId);
  const kindClass = item.kind ? KIND_CLASS[item.kind] : null;
  const [nowMs] = useState(() => Date.now());
  const isSnoozed = Boolean(item.snoozedUntil && Date.parse(item.snoozedUntil) > nowMs);

  return (
    <li className='space-y-2'>
      <div className='flex flex-wrap items-center gap-1.5'>
        {item.kind && kindClass ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${kindClass}`}>
            {KIND_LABELS[item.kind] ?? item.kind}
          </span>
        ) : null}
        {item.urgency ? (
          <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600'>
            {URGENCY_LABELS[item.urgency] ?? `Urgency ${item.urgency}`}
          </span>
        ) : null}
        {item.sources.map((source) => (
          <span
            key={source}
            className='rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600'
          >
            {source}
          </span>
        ))}
        {showCompare && item.compareStatus === 'new' ? (
          <span className='rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800'>
            New
          </span>
        ) : null}
        {showCompare && item.compareStatus === 'carried' ? (
          <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600'>
            Carried
          </span>
        ) : null}
        {isSnoozed ? (
          <span className='rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800'>
            Snoozed
          </span>
        ) : null}
      </div>
      <div className='flex items-start gap-2'>
        <input
          id={checkboxId}
          type='checkbox'
          className='mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900'
          checked={item.done}
          disabled={disabled}
          onChange={(event) => onDoneChange(item, event.target.checked)}
        />
        <label
          htmlFor={checkboxId}
          className={
            item.done
              ? 'text-sm font-medium text-slate-500 line-through'
              : 'text-sm font-medium text-slate-900'
          }
        >
          {item.title}
        </label>
      </div>
      {item.why ? <p className='pl-6 text-sm text-slate-600'>{item.why}</p> : null}
      {item.action ? <p className='pl-6 text-sm text-slate-700'>{item.action}</p> : null}
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 pl-6'>
        <LeadLink leadId={item.leadId} />
        <InvoiceLink invoiceId={item.invoiceId} />
        {inboxHref ? (
          <Link
            href={inboxHref}
            className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
          >
            Reply in inbox
          </Link>
        ) : null}
      </div>
      <div className='flex flex-wrap items-center gap-1.5 pl-6'>
        <Button
          type='button'
          size='sm'
          variant={item.feedback === 'up' ? 'secondary' : 'outline'}
          disabled={disabled}
          onClick={() => onFeedback(item, item.feedback === 'up' ? null : 'up')}
        >
          Helpful
        </Button>
        <Button
          type='button'
          size='sm'
          variant={item.feedback === 'down' ? 'secondary' : 'outline'}
          disabled={disabled}
          onClick={() => onFeedback(item, item.feedback === 'down' ? null : 'down')}
        >
          Not helpful
        </Button>
        <Button
          type='button'
          size='sm'
          variant={item.feedback === 'not_relevant' ? 'secondary' : 'outline'}
          disabled={disabled}
          onClick={() => onFeedback(item, item.feedback === 'not_relevant' ? null : 'not_relevant')}
        >
          Not relevant
        </Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={disabled}
          onClick={() => onSnooze(item, 'tomorrow')}
        >
          Snooze tomorrow
        </Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={disabled}
          onClick={() => onSnooze(item, 'next_week')}
        >
          Snooze next week
        </Button>
        {isSnoozed ? (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={disabled}
            onClick={() => onSnooze(item, 'clear')}
          >
            Clear snooze
          </Button>
        ) : null}
      </div>
    </li>
  );
}

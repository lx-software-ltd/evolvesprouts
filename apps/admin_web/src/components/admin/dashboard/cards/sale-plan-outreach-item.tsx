'use client';

import { useState } from 'react';
import Link from 'next/link';

import { CopyFeedbackIconButton } from '@/components/ui/copy-feedback-icon-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import type {
  SalesDailyPlanFeedback,
  SalesDailyPlanOutreach,
  SalesDailyPlanSnooze,
} from '@/types/sales-daily-plan';
import { SALES_DAILY_PLAN_DRAFT_MAX, salesInboxHref } from '@/types/sales-daily-plan';

export function SalePlanOutreachItem({
  item,
  index,
  disabled,
  onFeedback,
  onSnooze,
  onSaveDraft,
}: {
  item: SalesDailyPlanOutreach;
  index: number;
  disabled: boolean;
  onFeedback: (item: SalesDailyPlanOutreach, feedback: SalesDailyPlanFeedback | null) => void;
  onSnooze: (item: SalesDailyPlanOutreach, snooze: SalesDailyPlanSnooze) => void;
  onSaveDraft: (item: SalesDailyPlanOutreach, draftReply: string) => Promise<void>;
}) {
  const { copiedKey, markCopied } = useCopyFeedback(1000);
  const copyKey = `outreach-${index}`;
  const inboxHref = salesInboxHref(item.channel, item.conversationId);
  const [draft, setDraft] = useState(item.savedDraftReply || item.draftReply || '');
  const [isSaving, setIsSaving] = useState(false);
  const isSnoozed = Boolean(item.snoozedUntil && Date.parse(item.snoozedUntil) > Date.now());

  async function handleCopy() {
    const text = draft.trim() || item.draftReply;
    if (!text) {
      return;
    }
    await navigator.clipboard.writeText(text);
    markCopied(copyKey);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSaveDraft(item, draft.trim());
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className='space-y-2 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>{item.channel}</p>
        <div className='flex flex-wrap items-center gap-2'>
          <CopyFeedbackIconButton
            copied={copiedKey === copyKey}
            disabled={disabled || !(draft.trim() || item.draftReply)}
            onClick={() => {
              void handleCopy();
            }}
            idleLabel='Copy draft'
            copiedLabel='Copied draft'
          />
          {inboxHref ? (
            <Link
              href={inboxHref}
              className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
            >
              Reply in inbox
            </Link>
          ) : null}
        </div>
      </div>
      {item.messageExcerpt ? (
        <p className='text-sm text-slate-600'>Re: “{item.messageExcerpt}”</p>
      ) : null}
      <Textarea
        aria-label={`Outreach draft ${index + 1}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={SALES_DAILY_PLAN_DRAFT_MAX}
        rows={4}
        disabled={disabled}
      />
      {item.rationale ? <p className='text-xs text-slate-500'>{item.rationale}</p> : null}
      <div className='flex flex-wrap items-center gap-2'>
        {item.leadId ? (
          <Link
            href={`/sales?lead=${encodeURIComponent(item.leadId)}`}
            className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
          >
            Open lead
          </Link>
        ) : null}
        <Button
          type='button'
          size='sm'
          variant='secondary'
          disabled={disabled}
          loading={isSaving}
          loadingLabel='Saving…'
          onClick={() => {
            void handleSave();
          }}
        >
          Save draft
        </Button>
      </div>
      <div className='flex flex-wrap items-center gap-1.5'>
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
    </div>
  );
}

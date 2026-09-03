'use client';

import Link from 'next/link';

import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { StatusBanner } from '@/components/status-banner';
import { Button } from '@/components/ui/button';
import { useSalesDailyPlan } from '@/hooks/use-sales-daily-plan';
import type { SalesDailyPlanOutreach, SalesDailyPlanPriority } from '@/types/sales-daily-plan';

function formatStaleReasons(reasons: string[]): string {
  return reasons
    .map((reason) => {
      if (reason === 'age') {
        return 'older than 24 hours';
      }
      if (reason === 'new_conversation') {
        return 'newer conversation messages';
      }
      if (reason === 'pipeline_changed') {
        return 'pipeline activity since this plan';
      }
      return reason;
    })
    .join('; ');
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function LeadLink({ leadId, children }: { leadId: string | null; children: string }) {
  if (!leadId) {
    return null;
  }
  return (
    <Link
      href={`/sales?lead=${encodeURIComponent(leadId)}`}
      className='text-sm font-medium text-slate-900 underline-offset-2 hover:underline'
    >
      {children}
    </Link>
  );
}

function PriorityItem({ item }: { item: SalesDailyPlanPriority }) {
  return (
    <li className='space-y-1'>
      <p className='text-sm font-medium text-slate-900'>{item.title}</p>
      {item.why ? <p className='text-sm text-slate-600'>{item.why}</p> : null}
      {item.action ? <p className='text-sm text-slate-700'>{item.action}</p> : null}
      {item.leadId ? <LeadLink leadId={item.leadId}>Open lead</LeadLink> : null}
    </li>
  );
}

function OutreachItem({ item, index }: { item: SalesDailyPlanOutreach; index: number }) {
  return (
    <div
      key={`${item.channel}-${index}`}
      className='space-y-1 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0'
    >
      <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>{item.channel}</p>
      {item.messageExcerpt ? (
        <p className='text-sm text-slate-600'>Re: “{item.messageExcerpt}”</p>
      ) : null}
      <p className='whitespace-pre-wrap text-sm text-slate-700'>{item.draftReply || '—'}</p>
      {item.rationale ? <p className='text-xs text-slate-500'>{item.rationale}</p> : null}
      {item.leadId ? <LeadLink leadId={item.leadId}>Open lead</LeadLink> : null}
    </div>
  );
}

export function SalePlanOfTheDayCard() {
  const {
    plan,
    isLoading,
    loadError,
    generateError,
    isGenerating,
    lastJob,
    generate,
  } = useSalesDailyPlan();
  const error = generateError || loadError;
  const primaryLabel = plan ? 'Refresh insight' : 'Generate insight';

  return (
    <DashboardCard width='full' title='Sale Plan of the Day'>
      <div className='space-y-4' data-testid='sale-plan-of-the-day'>
        <p className='text-xs text-slate-500'>
          Sales-focused advice for today from your pipeline, unanswered messages, and
          catalogue. Saved until you regenerate. Suggestions are not sent automatically.
        </p>
        {error ? (
          <StatusBanner variant='error' title='Sale Plan of the Day'>
            {error}
          </StatusBanner>
        ) : null}

        {isGenerating ? (
          <p className='text-sm text-slate-600'>
            Generating insight
            {lastJob?.status ? ` (${lastJob.status})` : ''}…
          </p>
        ) : null}

        {lastJob && (lastJob.status === 'succeeded' || lastJob.status === 'failed') ? (
          <p className='text-xs text-slate-500'>
            Last run: queue {formatDuration(lastJob.queueWaitMs)} · model{' '}
            {formatDuration(lastJob.durationMs)}
            {lastJob.finishedAt
              ? ` · finished ${new Date(lastJob.finishedAt).toLocaleString()}`
              : ''}
          </p>
        ) : null}

        {isLoading ? <p className='text-sm text-slate-600'>Loading plan…</p> : null}

        {!isLoading && !plan ? (
          <p className='text-sm text-slate-600'>
            No plan yet. Generate insight to get a saved sales plan for today.
          </p>
        ) : null}

        {!isLoading && plan ? (
          <div className='space-y-4'>
            {plan.isStale ? (
              <StatusBanner variant='info' title='Plan may be stale'>
                {`This plan looks out of date (${formatStaleReasons(plan.staleReasons)}). Refresh to regenerate.`}
              </StatusBanner>
            ) : null}

            <div>
              <h3 className='text-sm font-medium text-slate-900'>Today&apos;s focus</h3>
              <p className='mt-1 whitespace-pre-wrap text-sm text-slate-700'>
                {plan.focus || '—'}
              </p>
            </div>

            {plan.priorities.length > 0 ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Priorities</h3>
                <ul className='mt-2 list-disc space-y-3 pl-5 text-sm text-slate-700'>
                  {plan.priorities.map((item) => (
                    <PriorityItem key={`${item.title}-${item.leadId ?? ''}`} item={item} />
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.outreach.length > 0 ? (
              <div className='space-y-3'>
                <h3 className='text-sm font-medium text-slate-900'>Outreach drafts</h3>
                {plan.outreach.map((item, index) => (
                  <OutreachItem key={`${item.channel}-${index}`} item={item} index={index} />
                ))}
              </div>
            ) : null}

            {plan.productFocus ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Product focus</h3>
                <p className='mt-1 whitespace-pre-wrap text-sm text-slate-700'>
                  {plan.productFocus}
                </p>
              </div>
            ) : null}

            {plan.offerRefinements.length > 0 ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Offer refinements</h3>
                <ul className='mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700'>
                  {plan.offerRefinements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.risks.length > 0 ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Risks / cautions</h3>
                <ul className='mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700'>
                  {plan.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className='text-xs text-slate-500'>
              Generated{' '}
              {plan.generatedAt ? new Date(plan.generatedAt).toLocaleString() : '—'}
              {plan.staleAfter
                ? ` · Age-stale after ${new Date(plan.staleAfter).toLocaleString()}`
                : ''}
            </p>
          </div>
        ) : null}

        <div className='flex flex-wrap items-center justify-start gap-2'>
          <Button
            type='button'
            onClick={() => void generate()}
            disabled={isLoading}
            loading={isGenerating}
            loadingLabel='Generating…'
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </DashboardCard>
  );
}

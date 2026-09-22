'use client';

import { useMemo, useState } from 'react';

import { SalePlanOutreachItem } from '@/components/admin/dashboard/cards/sale-plan-outreach-item';
import { SalePlanPriorityItem } from '@/components/admin/dashboard/cards/sale-plan-priority-item';
import { DashboardCard } from '@/components/admin/dashboard/dashboard-card';
import { useAuth } from '@/components/auth-provider';
import { StatusBanner } from '@/components/status-banner';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSalesDailyPlan } from '@/hooks/use-sales-daily-plan';
import type {
  SalesDailyPlanFeedback,
  SalesDailyPlanInstructionScope,
  SalesDailyPlanMemoryEntry,
  SalesDailyPlanOutreach,
  SalesDailyPlanPriority,
  SalesDailyPlanSnooze,
  SalesDailyPlanSuppressedItem,
} from '@/types/sales-daily-plan';
import {
  SALES_DAILY_PLAN_OPERATOR_INPUT_MAX,
  SALES_DAILY_PLAN_QUESTION_MAX,
  SALES_DAILY_PLAN_REFINEMENT_CHIPS,
  salesDailyPlanItemIsSnoozed,
} from '@/types/sales-daily-plan';

function formatStaleReasons(
  reasons: string[],
  counts: { newConversation: number; pipelineChanged: number; contactsChanged: number },
): string {
  return reasons
    .map((reason) => {
      if (reason === 'age') {
        return 'older than 24 hours';
      }
      if (reason === 'new_conversation') {
        const count = counts.newConversation;
        return count > 0
          ? `${count} newer conversation message${count === 1 ? '' : 's'}`
          : 'newer conversation messages';
      }
      if (reason === 'pipeline_changed') {
        const count = counts.pipelineChanged;
        return count > 0
          ? `${count} pipeline event${count === 1 ? '' : 's'} since this plan`
          : 'pipeline activity since this plan';
      }
      if (reason === 'contacts_changed') {
        const count = counts.contactsChanged;
        return count > 0
          ? `${count} contact change${count === 1 ? '' : 's'} since this plan`
          : 'contact changes since this plan';
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

function MemoryEntry({ entry }: { entry: SalesDailyPlanMemoryEntry }) {
  return (
    <li className='space-y-1 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0'>
      <p className='text-xs text-slate-500'>
        {entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : '—'}
      </p>
      <p className='text-sm text-slate-700'>{entry.focus || '—'}</p>
      {entry.operatorInput ? (
        <p className='whitespace-pre-wrap text-sm text-slate-600'>
          Refinement: {entry.operatorInput}
        </p>
      ) : null}
    </li>
  );
}

const SUPPRESSED_REASON_LABELS: Record<SalesDailyPlanSuppressedItem['reason'], string> = {
  done_today: 'Done until 6:00 HKT',
  dismissed: 'Not relevant',
  snoozed: 'Snoozed',
};

function appendChip(current: string, chip: string): string {
  if (!current.trim()) {
    return chip;
  }
  if (current.includes(chip)) {
    return current;
  }
  return `${current.trim()}\n${chip}`;
}

export function SalePlanOfTheDayCard() {
  const { user } = useAuth();
  const {
    plan,
    memory,
    instructions,
    isLoading,
    loadError,
    generateError,
    isGenerating,
    lastJob,
    generate,
    removeInstruction,
    setPriorityDone,
    annotateItem,
    askFollowUp,
    loadComparison,
  } = useSalesDailyPlan();
  const [refinement, setRefinement] = useState('');
  const [refinementScope, setRefinementScope] = useState<SalesDailyPlanInstructionScope>('today');
  const [pendingPriorityKey, setPendingPriorityKey] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'mine'>('all');
  const [showCompare, setShowCompare] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [followUpError, setFollowUpError] = useState('');
  const [actionError, setActionError] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const scheduledJobError =
    lastJob?.status === 'failed' ? lastJob.errorMessage?.trim() || 'Insight generation failed.' : '';
  const error = generateError || loadError || scheduledJobError || actionError;
  const primaryLabel = plan ? 'Refresh insight' : 'Generate insight';
  const previousMemory = memory.filter((entry) => entry.id !== plan?.id);
  const subject = user?.subject ?? '';

  const assignedPriorities = useMemo(() => {
    const items = plan?.priorities ?? [];
    if (assigneeFilter === 'mine' && subject) {
      return items.filter((item) => item.assignedTo === subject);
    }
    return items;
  }, [assigneeFilter, plan?.priorities, subject]);

  const assignedOutreach = useMemo(() => {
    const items = plan?.outreach ?? [];
    if (assigneeFilter === 'mine' && subject) {
      return items.filter((item) => item.assignedTo === subject);
    }
    return items;
  }, [assigneeFilter, plan?.outreach, subject]);

  const snoozedPriorityCount = assignedPriorities.filter((item) =>
    salesDailyPlanItemIsSnoozed(item.snoozedUntil, nowMs),
  ).length;
  const snoozedOutreachCount = assignedOutreach.filter((item) =>
    salesDailyPlanItemIsSnoozed(item.snoozedUntil, nowMs),
  ).length;
  const snoozedCount = snoozedPriorityCount + snoozedOutreachCount;

  const visiblePriorities = showSnoozed
    ? assignedPriorities
    : assignedPriorities.filter((item) => !salesDailyPlanItemIsSnoozed(item.snoozedUntil, nowMs));
  const visibleOutreach = showSnoozed
    ? assignedOutreach
    : assignedOutreach.filter((item) => !salesDailyPlanItemIsSnoozed(item.snoozedUntil, nowMs));

  const doneCount = visiblePriorities.filter((item) => item.done).length;
  const hiddenItems = plan?.suppressedItems ?? [];

  async function handleGenerate() {
    const note = refinement.trim();
    const succeeded = await generate(note || undefined, note ? refinementScope : undefined);
    if (succeeded) {
      setRefinement('');
    }
  }

  async function withActionError(work: () => Promise<void>) {
    setActionError('');
    try {
      await work();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Failed to update the insight.',
      );
    }
  }

  async function handlePriorityDone(item: SalesDailyPlanPriority, done: boolean) {
    setPendingPriorityKey(item.itemKey);
    try {
      await withActionError(() => setPriorityDone(item, done));
    } finally {
      setPendingPriorityKey(null);
    }
  }

  async function handlePriorityFeedback(
    item: SalesDailyPlanPriority,
    feedback: SalesDailyPlanFeedback | null,
  ) {
    await withActionError(() =>
      annotateItem({ itemKind: 'priority', itemKey: item.itemKey, feedback }),
    );
  }

  async function handlePrioritySnooze(item: SalesDailyPlanPriority, snooze: SalesDailyPlanSnooze) {
    await withActionError(() =>
      annotateItem({ itemKind: 'priority', itemKey: item.itemKey, snooze }),
    );
  }

  async function handleOutreachFeedback(
    item: SalesDailyPlanOutreach,
    feedback: SalesDailyPlanFeedback | null,
  ) {
    await withActionError(() =>
      annotateItem({ itemKind: 'outreach', itemKey: item.itemKey, feedback }),
    );
  }

  async function handleOutreachSnooze(item: SalesDailyPlanOutreach, snooze: SalesDailyPlanSnooze) {
    await withActionError(() =>
      annotateItem({ itemKind: 'outreach', itemKey: item.itemKey, snooze }),
    );
  }

  async function handleSaveDraft(item: SalesDailyPlanOutreach, draftReply: string) {
    await withActionError(() =>
      annotateItem({ itemKind: 'outreach', itemKey: item.itemKey, draftReply }),
    );
  }

  async function handleToggleCompare() {
    const next = !showCompare;
    setShowCompare(next);
    if (!next) {
      return;
    }
    setIsComparing(true);
    setActionError('');
    try {
      await loadComparison();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : 'Failed to compare with the previous insight.',
      );
    } finally {
      setIsComparing(false);
    }
  }

  async function handleAskFollowUp() {
    const question = followUp.trim();
    if (!question) {
      return;
    }
    setIsAsking(true);
    setFollowUpError('');
    try {
      await askFollowUp(question);
      setFollowUp('');
    } catch (askError) {
      setFollowUpError(
        askError instanceof Error ? askError.message : 'Failed to ask a follow-up question.',
      );
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <DashboardCard width='full' title='Sale Plan of the Day'>
      <div className='space-y-4' data-testid='sale-plan-of-the-day'>
        <p className='text-xs text-slate-500'>
          Sales-focused advice for today from your pipeline, unanswered messages,
          unpaid invoices, catalogue, and saved insights. A new plan is generated
          every morning at 6:00 HKT. You can also refresh it here. Ticked tasks stay
          hidden until the next 6:00 HKT. A refinement lasts until then, or until
          you remove it when you choose Keep until removed. Reset in Sales
          configuration clears plans, instructions, and hidden tasks. Suggestions
          are not sent automatically.
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
            {plan?.model ? ` · ${plan.model}` : ''}
            {lastJob.finishedAt
              ? ` · finished ${new Date(lastJob.finishedAt).toLocaleString()}`
              : ''}
          </p>
        ) : null}

        {isLoading ? <p className='text-sm text-slate-600'>Loading plan…</p> : null}

        {!isLoading && !plan ? (
          <p className='text-sm text-slate-600'>
            No plan yet. One is generated every morning at 6:00 HKT, or generate
            insight now.
          </p>
        ) : null}

        {!isLoading && plan ? (
          <div className='space-y-4'>
            {plan.isStale ? (
              <StatusBanner variant='info' title='Plan may be stale'>
                {`This plan looks out of date (${formatStaleReasons(
                  plan.staleReasons,
                  plan.staleCounts ?? {
                    newConversation: 0,
                    pipelineChanged: 0,
                    contactsChanged: 0,
                  },
                )}). Refresh to regenerate.`}
              </StatusBanner>
            ) : null}

            {plan.operatorInput ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Your refinement</h3>
                <p className='mt-1 whitespace-pre-wrap text-sm text-slate-700'>
                  {plan.operatorInput}
                </p>
              </div>
            ) : null}

            <div>
              <h3 className='text-sm font-medium text-slate-900'>Today&apos;s focus</h3>
              <p className='mt-1 whitespace-pre-wrap text-sm text-slate-700'>
                {plan.focus || '—'}
              </p>
            </div>

            <div className='flex flex-wrap items-center justify-between gap-2'>
              <AdminTabStrip
                aria-label='Insight assignment filter'
                items={[
                  { key: 'all', label: 'All' },
                  { key: 'mine', label: 'Mine' },
                ]}
                activeKey={assigneeFilter}
                onChange={setAssigneeFilter}
              />
              <div className='flex flex-wrap items-center gap-2'>
                {snoozedCount > 0 ? (
                  <Button
                    type='button'
                    size='sm'
                    variant={showSnoozed ? 'secondary' : 'outline'}
                    aria-pressed={showSnoozed}
                    onClick={() => setShowSnoozed((current) => !current)}
                  >
                    {showSnoozed ? 'Hide snoozed' : `Show snoozed (${snoozedCount})`}
                  </Button>
                ) : null}
                <Button
                  type='button'
                  size='sm'
                  variant={showCompare ? 'secondary' : 'outline'}
                  aria-pressed={showCompare}
                  loading={isComparing}
                  loadingLabel='Comparing…'
                  onClick={() => {
                    void handleToggleCompare();
                  }}
                >
                  Compare with previous
                </Button>
              </div>
            </div>

            {plan.priorities.length > 0 ? (
              <div>
                <div className='flex flex-wrap items-baseline justify-between gap-2'>
                  <h3 className='text-sm font-medium text-slate-900'>Priorities</h3>
                  <p className='text-xs text-slate-500'>
                    {doneCount} of {visiblePriorities.length} done
                  </p>
                </div>
                {visiblePriorities.length === 0 ? (
                  <p className='mt-2 text-sm text-slate-600'>
                    {assigneeFilter === 'mine' && assignedPriorities.length === 0
                      ? 'No priorities assigned to you.'
                      : 'Snoozed priorities are hidden.'}
                  </p>
                ) : (
                  <ul className='mt-2 space-y-3 text-sm text-slate-700'>
                    {visiblePriorities.map((item) => (
                      <SalePlanPriorityItem
                        key={item.itemKey}
                        item={item}
                        showCompare={showCompare}
                        nowMs={nowMs}
                        disabled={isGenerating || pendingPriorityKey === item.itemKey}
                        onDoneChange={(nextItem, done) => {
                          void handlePriorityDone(nextItem, done);
                        }}
                        onFeedback={handlePriorityFeedback}
                        onSnooze={handlePrioritySnooze}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {showCompare && (plan.droppedPriorities?.length ?? 0) > 0 ? (
              <div>
                <h3 className='text-sm font-medium text-slate-900'>Dropped since last plan</h3>
                <ul className='mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600'>
                  {plan.droppedPriorities.map((item) => (
                    <li key={`${item.title}-${item.leadId ?? ''}-${item.invoiceId ?? ''}`}>
                      {item.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.outreach.length > 0 ? (
              <div className='space-y-3'>
                <h3 className='text-sm font-medium text-slate-900'>Outreach drafts</h3>
                {visibleOutreach.length === 0 ? (
                  <p className='text-sm text-slate-600'>
                    {assigneeFilter === 'mine' && assignedOutreach.length === 0
                      ? 'No outreach drafts assigned to you.'
                      : 'Snoozed outreach drafts are hidden.'}
                  </p>
                ) : (
                  visibleOutreach.map((item, index) => (
                    <SalePlanOutreachItem
                      key={item.itemKey}
                      item={item}
                      index={index}
                      nowMs={nowMs}
                      disabled={isGenerating}
                      onFeedback={handleOutreachFeedback}
                      onSnooze={handleOutreachSnooze}
                      onSaveDraft={handleSaveDraft}
                    />
                  ))
                )}
              </div>
            ) : null}

            {hiddenItems.length > 0 ? (
              <AdminDisclosure
                id='sale-plan-hidden'
                title='Hidden this run'
                summary={String(hiddenItems.length)}
              >
                <ul className='space-y-2'>
                  {hiddenItems.map((item) => (
                    <li
                      key={`${item.itemKind}-${item.itemKey}`}
                      className='flex flex-wrap items-center justify-between gap-2'
                    >
                      <span className='text-sm text-slate-700'>
                        {item.title}
                        <span className='text-slate-500'>
                          {' '}
                          · {SUPPRESSED_REASON_LABELS[item.reason]}
                        </span>
                      </span>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        disabled={isGenerating}
                        onClick={() => {
                          void withActionError(async () => {
                            if (item.reason === 'snoozed') {
                              await annotateItem({
                                itemKind: item.itemKind,
                                itemKey: item.itemKey,
                                snooze: 'clear',
                              });
                              return;
                            }
                            if (item.reason === 'dismissed') {
                              await annotateItem({
                                itemKind: item.itemKind,
                                itemKey: item.itemKey,
                                feedback: null,
                              });
                              return;
                            }
                            await setPriorityDone(
                              {
                                title: item.title,
                                why: '',
                                action: '',
                                kind: null,
                                urgency: 2,
                                sources: [],
                                leadId: item.leadId,
                                invoiceId: item.invoiceId,
                                conversationId: null,
                                channel: null,
                                assignedTo: null,
                                itemKey: item.itemKey,
                                done: true,
                                feedback: null,
                                snoozedUntil: null,
                                compareStatus: null,
                                instructionId: null,
                                fromInstruction: false,
                                resurfaced: false,
                              },
                              false,
                            );
                          });
                        }}
                      >
                        Show again
                      </Button>
                    </li>
                  ))}
                </ul>
              </AdminDisclosure>
            ) : null}

            {plan.productFocus ? (
              <AdminDisclosure id='sale-plan-product-focus' title='Product focus'>
                <p className='whitespace-pre-wrap text-sm text-slate-700'>{plan.productFocus}</p>
              </AdminDisclosure>
            ) : null}

            {plan.offerRefinements.length > 0 ? (
              <AdminDisclosure
                id='sale-plan-offer-refinements'
                title='Offer refinements'
                summary={String(plan.offerRefinements.length)}
              >
                <ul className='list-disc space-y-1 pl-5 text-sm text-slate-700'>
                  {plan.offerRefinements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </AdminDisclosure>
            ) : null}

            {plan.risks.length > 0 ? (
              <AdminDisclosure
                id='sale-plan-risks'
                title='Risks / cautions'
                summary={String(plan.risks.length)}
              >
                <ul className='list-disc space-y-1 pl-5 text-sm text-slate-700'>
                  {plan.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </AdminDisclosure>
            ) : null}

            <div className='space-y-2'>
              <Label htmlFor='sale-plan-follow-up'>Ask a follow-up</Label>
              <Textarea
                id='sale-plan-follow-up'
                value={followUp}
                onChange={(event) => setFollowUp(event.target.value)}
                maxLength={SALES_DAILY_PLAN_QUESTION_MAX}
                rows={2}
                disabled={isGenerating || isAsking}
                placeholder='Ask about this stored plan. Uses the plan JSON only.'
              />
              {followUpError ? (
                <p className='text-sm text-red-700'>{followUpError}</p>
              ) : null}
              <Button
                type='button'
                size='sm'
                variant='secondary'
                disabled={!followUp.trim()}
                loading={isAsking}
                loadingLabel='Asking…'
                onClick={() => {
                  void handleAskFollowUp();
                }}
              >
                Ask
              </Button>
              {(plan.questions ?? []).length > 0 ? (
                <ul className='space-y-3'>
                  {plan.questions.map((entry) => (
                    <li key={entry.id} className='space-y-1 border-t border-slate-200 pt-3'>
                      <p className='text-sm font-medium text-slate-900'>{entry.question}</p>
                      <p className='whitespace-pre-wrap text-sm text-slate-700'>{entry.answer}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <p className='text-xs text-slate-500'>
              Generated
              {plan.generatedByName ? ` for ${plan.generatedByName}` : ''}{' '}
              {plan.generatedAt ? new Date(plan.generatedAt).toLocaleString() : '—'}
              {plan.model ? ` · ${plan.model}` : ''}
              {plan.staleAfter
                ? ` · Age-stale after ${new Date(plan.staleAfter).toLocaleString()}`
                : ''}
            </p>
          </div>
        ) : null}

        {previousMemory.length > 0 ? (
          <AdminDisclosure
            id='sale-plan-memory'
            title='Previous insights'
            summary={String(previousMemory.length)}
          >
            <ul className='space-y-0'>
              {previousMemory.map((entry) => (
                <MemoryEntry key={entry.id} entry={entry} />
              ))}
            </ul>
          </AdminDisclosure>
        ) : null}

        {instructions.length > 0 ? (
          <div className='space-y-2'>
            <h3 className='text-sm font-medium text-slate-900'>Active instructions</h3>
            <ul className='space-y-2'>
              {instructions.map((entry) => (
                <li
                  key={entry.id}
                  className='flex flex-wrap items-start justify-between gap-2'
                >
                  <p className='text-sm text-slate-700'>
                    <span className='font-medium text-slate-900'>
                      {entry.scope === 'standing' ? 'Kept' : 'Today'}
                    </span>
                    {' '}
                    {entry.text}
                  </p>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={isGenerating}
                    onClick={() => {
                      void withActionError(() => removeInstruction(entry.id));
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className='space-y-2'>
          <Label htmlFor='sale-plan-refinement'>Refinement for the next insight</Label>
          <div className='flex flex-wrap gap-1.5' role='group' aria-label='Refinement lifetime'>
            <Button
              type='button'
              size='sm'
              variant={refinementScope === 'today' ? 'secondary' : 'outline'}
              aria-pressed={refinementScope === 'today'}
              disabled={isGenerating || isLoading}
              onClick={() => setRefinementScope('today')}
            >
              Today only
            </Button>
            <Button
              type='button'
              size='sm'
              variant={refinementScope === 'standing' ? 'secondary' : 'outline'}
              aria-pressed={refinementScope === 'standing'}
              disabled={isGenerating || isLoading}
              onClick={() => setRefinementScope('standing')}
            >
              Keep until removed
            </Button>
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {SALES_DAILY_PLAN_REFINEMENT_CHIPS.map((chip) => (
              <Button
                key={chip}
                type='button'
                size='sm'
                variant='outline'
                disabled={isGenerating || isLoading}
                onClick={() => setRefinement((current) => appendChip(current, chip))}
              >
                {chip}
              </Button>
            ))}
          </div>
          <Textarea
            id='sale-plan-refinement'
            value={refinement}
            onChange={(event) => setRefinement(event.target.value)}
            maxLength={SALES_DAILY_PLAN_OPERATOR_INPUT_MAX}
            rows={3}
            disabled={isGenerating || isLoading}
            placeholder='Optional. Today only lasts until 6:00 HKT. Keep until removed is included in every later insight.'
          />
        </div>

        <div className='flex flex-wrap items-center justify-start gap-2'>
          <Button
            type='button'
            onClick={() => void handleGenerate()}
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

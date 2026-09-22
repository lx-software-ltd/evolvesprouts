export type SalesDailyPlanJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type SalesDailyPlanStaleReason =
  | 'age'
  | 'new_conversation'
  | 'pipeline_changed'
  | 'contacts_changed';

export type SalesDailyPlanPriorityKind =
  | 'reply'
  | 'close'
  | 'chase_payment'
  | 'book'
  | 'offer';

export type SalesDailyPlanFeedback = 'up' | 'down' | 'not_relevant';

export type SalesDailyPlanSnooze = 'tomorrow' | 'next_week' | 'clear';

export type SalesDailyPlanCompareStatus = 'new' | 'carried';

export type SalesDailyPlanItemKind = 'priority' | 'outreach';

export type SalesDailyPlanInstructionScope = 'today' | 'standing';

export type SalesDailyPlanSuppressedReason = 'done_today' | 'dismissed' | 'snoozed';

export interface SalesDailyPlanStaleCounts {
  newConversation: number;
  pipelineChanged: number;
  contactsChanged: number;
}

export interface SalesDailyPlanPriority {
  title: string;
  why: string;
  action: string;
  kind: SalesDailyPlanPriorityKind | null;
  urgency: number;
  sources: string[];
  leadId: string | null;
  invoiceId: string | null;
  conversationId: string | null;
  channel: string | null;
  assignedTo: string | null;
  itemKey: string;
  done: boolean;
  feedback: SalesDailyPlanFeedback | null;
  snoozedUntil: string | null;
  compareStatus: SalesDailyPlanCompareStatus | null;
  instructionId: string | null;
  fromInstruction: boolean;
  resurfaced: boolean;
}

export interface SalesDailyPlanOutreach {
  channel: string;
  leadId: string | null;
  conversationId: string | null;
  assignedTo: string | null;
  messageExcerpt: string;
  draftReply: string;
  rationale: string;
  itemKey: string;
  feedback: SalesDailyPlanFeedback | null;
  snoozedUntil: string | null;
  savedDraftReply: string | null;
}

export interface SalesDailyPlanDroppedPriority {
  title: string;
  leadId: string | null;
  invoiceId: string | null;
}

export interface SalesDailyPlanQuestion {
  id: string;
  question: string;
  answer: string;
  askedBy: string | null;
  askedAt: string | null;
  model: string | null;
}

export interface SalesDailyPlan {
  id: string;
  focus: string;
  priorities: SalesDailyPlanPriority[];
  outreach: SalesDailyPlanOutreach[];
  productFocus: string;
  offerRefinements: string[];
  risks: string[];
  suppressedItems: SalesDailyPlanSuppressedItem[];
  droppedPriorities: SalesDailyPlanDroppedPriority[];
  questions: SalesDailyPlanQuestion[];
  generatedAt: string | null;
  generatedBy: string | null;
  generatedByName: string | null;
  model: string | null;
  operatorInput: string | null;
  conversationWatermarkAt: string | null;
  pipelineWatermarkAt: string | null;
  isStale: boolean;
  staleReasons: string[];
  staleCounts: SalesDailyPlanStaleCounts;
  staleAfter: string | null;
  latestMessageAt: string | null;
  latestPipelineAt: string | null;
  latestContactAt: string | null;
}

export interface SalesDailyPlanSuppressedItem {
  title: string;
  itemKey: string;
  itemKind: SalesDailyPlanItemKind;
  reason: SalesDailyPlanSuppressedReason;
  leadId: string | null;
  invoiceId: string | null;
}

export interface SalesDailyPlanInstruction {
  id: string;
  text: string;
  scope: SalesDailyPlanInstructionScope;
  activeUntil: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface SalesDailyPlanMemoryEntry {
  id: string;
  generatedAt: string | null;
  focus: string;
  productFocus: string;
  operatorInput: string | null;
  priorities: SalesDailyPlanDroppedPriority[];
}

export interface SalesDailyPlanSnapshot {
  plan: SalesDailyPlan | null;
  memory: SalesDailyPlanMemoryEntry[];
  instructions: SalesDailyPlanInstruction[];
  job: SalesDailyPlanJob | null;
}

export const SALES_DAILY_PLAN_OPERATOR_INPUT_MAX = 4000;
export const SALES_DAILY_PLAN_QUESTION_MAX = 2000;
export const SALES_DAILY_PLAN_DRAFT_MAX = 4000;

export function salesDailyPlanItemIsSnoozed(
  snoozedUntil: string | null,
  nowMs: number,
): boolean {
  return Boolean(snoozedUntil && Date.parse(snoozedUntil) > nowMs);
}

export const SALES_DAILY_PLAN_REFINEMENT_CHIPS = [
  'Focus on my assigned leads',
  'Chase overdue invoices first',
  'Shorter outreach drafts',
  'More booking actions',
  'Skip already-ticked work',
] as const;

export interface SalesDailyPlanJob {
  id: string;
  status: SalesDailyPlanJobStatus;
  errorMessage: string | null;
  operatorInput: string | null;
  planId: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  queueWaitMs: number | null;
  durationMs: number | null;
  plan: SalesDailyPlan | null;
}

export function salesDailyPlanPriorityKey(item: {
  title: string;
  leadId?: string | null;
  invoiceId?: string | null;
}): string {
  return `${item.title.trim()}\n${item.leadId ?? ''}\n${item.invoiceId ?? ''}`;
}

export function salesDailyPlanOutreachKey(item: {
  channel: string;
  leadId?: string | null;
  conversationId?: string | null;
  messageExcerpt?: string | null;
}): string {
  return `${item.channel.trim() || 'unknown'}\n${item.leadId ?? ''}\n${item.conversationId ?? ''}\n${(item.messageExcerpt ?? '').trim()}`;
}

export function salesInboxHref(
  channel: string,
  conversationId: string | null,
): string | null {
  if (!conversationId) {
    return null;
  }
  const tab =
    channel === 'whatsapp'
      ? 'whatsapp'
      : channel === 'instagram'
        ? 'instagram'
        : channel === 'messenger' || channel === 'facebook'
          ? 'messenger'
          : null;
  if (!tab) {
    return null;
  }
  return `/sales?tab=${tab}&conversation=${encodeURIComponent(conversationId)}`;
}

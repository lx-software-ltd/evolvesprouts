export type SalesDailyPlanJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type SalesDailyPlanStaleReason = 'age' | 'new_conversation' | 'pipeline_changed';

export interface SalesDailyPlanPriority {
  title: string;
  why: string;
  action: string;
  leadId: string | null;
}

export interface SalesDailyPlanOutreach {
  channel: string;
  leadId: string | null;
  messageExcerpt: string;
  draftReply: string;
  rationale: string;
}

export interface SalesDailyPlan {
  id: string;
  focus: string;
  priorities: SalesDailyPlanPriority[];
  outreach: SalesDailyPlanOutreach[];
  productFocus: string;
  offerRefinements: string[];
  risks: string[];
  generatedAt: string | null;
  generatedBy: string | null;
  model: string | null;
  conversationWatermarkAt: string | null;
  pipelineWatermarkAt: string | null;
  isStale: boolean;
  staleReasons: string[];
  staleAfter: string | null;
  latestMessageAt: string | null;
  latestPipelineAt: string | null;
}

export interface SalesDailyPlanJob {
  id: string;
  status: SalesDailyPlanJobStatus;
  errorMessage: string | null;
  planId: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  queueWaitMs: number | null;
  durationMs: number | null;
  plan: SalesDailyPlan | null;
}

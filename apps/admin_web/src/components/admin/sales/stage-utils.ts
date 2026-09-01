import type { FunnelStage } from '@/types/leads';

export const STAGE_BADGE_CLASS: Record<FunnelStage, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-cyan-100 text-cyan-800',
  engaged: 'bg-indigo-100 text-indigo-800',
  qualified: 'bg-violet-100 text-violet-800',
  unqualified: 'bg-amber-100 text-amber-800',
  converted: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-red-100 text-red-800',
};

export function getStageBadgeClass(stage: FunnelStage): string {
  return STAGE_BADGE_CLASS[stage];
}

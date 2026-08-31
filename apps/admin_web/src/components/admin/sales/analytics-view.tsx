import { EMPTY_ANALYTICS } from './analytics-defaults';
import { ConversionFunnel } from './conversion-funnel';
import { LeadsOverTime } from './leads-over-time';
import { TimeInStage } from './time-in-stage';

import type { LeadAnalytics } from '@/types/leads';

export interface AnalyticsViewProps {
  analytics: LeadAnalytics | null;
}

export function AnalyticsView({ analytics }: AnalyticsViewProps) {
  const data = analytics ?? EMPTY_ANALYTICS;
  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <ConversionFunnel rates={data.stageConversionRates} />
      <LeadsOverTime values={data.leadsOverTime} />
      <TimeInStage values={data.avgDaysInStage} />
    </div>
  );
}

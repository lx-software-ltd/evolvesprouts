'use client';

import { FUNNEL_STAGES } from '@/types/leads';
import type { FunnelStage } from '@/types/leads';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card } from '@/components/ui/card';
import { formatEnumLabel } from '@/lib/format';

import { getStageBadgeClass } from './stage-utils';

export interface FunnelChartProps {
  funnel: Record<string, number>;
  activeStage?: FunnelStage | null;
  onSelectStage?: (stage: FunnelStage | null) => void;
}

export function FunnelChart({ funnel, activeStage = null, onSelectStage }: FunnelChartProps) {
  const total = FUNNEL_STAGES.reduce(
    (accumulator, stage) => accumulator + (funnel[stage] ?? 0),
    0
  );
  const chartData = FUNNEL_STAGES.map((stage) => ({
    stage,
    label: formatEnumLabel(stage),
    count: funnel[stage] ?? 0,
  }));
  const colors: Record<FunnelStage, string> = {
    new: '#3b82f6',
    contacted: '#06b6d4',
    engaged: '#6366f1',
    qualified: '#8b5cf6',
    converted: '#10b981',
    lost: '#ef4444',
  };

  return (
    <Card title='Funnel' className='space-y-3'>
      <div className='h-72'>
        <ResponsiveContainer width='100%' height='100%'>
          <BarChart
            data={chartData}
            layout='vertical'
            margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis type='number' />
            <YAxis type='category' dataKey='label' width={90} />
            <Tooltip
              formatter={(value) => {
                const normalizedValue = Number(value ?? 0);
                const percentage =
                  total > 0 ? ((normalizedValue / total) * 100).toFixed(1) : '0.0';
                return [`${normalizedValue} (${percentage}%)`, 'Leads'];
              }}
            />
            <Bar dataKey='count' radius={[0, 6, 6, 0]}>
              {chartData.map((entry) => (
                <Cell
                  key={entry.stage}
                  fill={colors[entry.stage]}
                  opacity={activeStage && activeStage !== entry.stage ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {onSelectStage ? (
        <div className='flex flex-wrap gap-2'>
          {FUNNEL_STAGES.map((stage) => (
            <button
              key={stage}
              type='button'
              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStageBadgeClass(stage)} ${
                activeStage === stage ? 'ring-2 ring-slate-400' : ''
              }`}
              onClick={() => onSelectStage(activeStage === stage ? null : stage)}
            >
              {formatEnumLabel(stage)}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

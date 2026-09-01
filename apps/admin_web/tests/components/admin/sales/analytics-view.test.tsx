import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/admin/sales/conversion-funnel', () => ({
  ConversionFunnel: () => <div>Conversion Funnel</div>,
}));

vi.mock('@/components/admin/sales/leads-over-time', () => ({
  LeadsOverTime: () => <div>Leads Over Time</div>,
}));

vi.mock('@/components/admin/sales/time-in-stage', () => ({
  TimeInStage: () => <div>Time in Stage</div>,
}));

vi.mock('@/components/admin/sales/funnel-chart', () => ({
  FunnelChart: () => <div>Funnel</div>,
}));

vi.mock('@/components/admin/sales/source-breakdown', () => ({
  SourceBreakdown: () => <div>Source Breakdown</div>,
}));

import { AnalyticsView } from '@/components/admin/sales/analytics-view';

describe('AnalyticsView', () => {
  it('renders KPI, funnel, source, and trend cards', () => {
    render(<AnalyticsView analytics={null} />);

    expect(screen.getByText('Total leads')).toBeInTheDocument();
    expect(screen.getByText('Conversion rate')).toBeInTheDocument();
    expect(screen.getByText('Avg. days to convert')).toBeInTheDocument();
    expect(screen.getByText('New this week')).toBeInTheDocument();
    expect(screen.getByText('Funnel')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Conversion Funnel')).toBeInTheDocument();
    expect(screen.getByText('Leads Over Time')).toBeInTheDocument();
    expect(screen.getByText('Time in Stage')).toBeInTheDocument();
    expect(screen.queryByText('Team Performance')).not.toBeInTheDocument();
    expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
    expect(screen.queryByText('No assignee performance data.')).not.toBeInTheDocument();
  });
});

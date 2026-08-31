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

import { AnalyticsView } from '@/components/admin/sales/analytics-view';

describe('AnalyticsView', () => {
  it('renders funnel charts and hides assignee performance', () => {
    render(<AnalyticsView analytics={null} />);

    expect(screen.getByText('Conversion Funnel')).toBeInTheDocument();
    expect(screen.getByText('Leads Over Time')).toBeInTheDocument();
    expect(screen.getByText('Time in Stage')).toBeInTheDocument();
    expect(screen.queryByText('Team Performance')).not.toBeInTheDocument();
    expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
    expect(screen.queryByText('No assignee performance data.')).not.toBeInTheDocument();
  });
});

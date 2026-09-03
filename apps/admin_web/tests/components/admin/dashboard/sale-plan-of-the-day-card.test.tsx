import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchSalesDailyPlan,
  enqueueSalesDailyPlanJob,
  pollSalesDailyPlanJob,
} = vi.hoisted(() => ({
  fetchSalesDailyPlan: vi.fn(),
  enqueueSalesDailyPlanJob: vi.fn(),
  pollSalesDailyPlanJob: vi.fn(),
}));

vi.mock('@/lib/sales-daily-plan-api', () => ({
  fetchSalesDailyPlan,
  enqueueSalesDailyPlanJob,
  pollSalesDailyPlanJob,
}));

import { SalePlanOfTheDayCard } from '@/components/admin/dashboard/cards/sale-plan-of-the-day-card';
import { AdminApiError } from '@/lib/api-admin-client';

const samplePlan = {
  id: 'plan-1',
  focus: 'Close Family Consultation conversations.',
  priorities: [
    {
      title: 'Reply to Mei',
      why: 'Inbound yesterday asking about helper training.',
      action: 'Send a consult CTA on WhatsApp.',
      leadId: 'lead-1',
      invoiceId: null,
    },
  ],
  outreach: [
    {
      channel: 'whatsapp',
      leadId: 'lead-1',
      messageExcerpt: 'Is this for helpers?',
      draftReply: 'Yes — My Best Auntie is helper training focused on ages 0–6.',
      rationale: 'Answer the inbound question directly.',
    },
  ],
  productFocus: 'Push Family Consultations this week.',
  offerRefinements: ['Tighten MBA intro copy around daily routines.'],
  risks: ['Do not invent pricing'],
  generatedAt: '2026-09-01T10:00:00Z',
  generatedBy: 'user-1',
  model: 'test-model',
  conversationWatermarkAt: '2026-09-01T09:00:00Z',
  pipelineWatermarkAt: '2026-09-01T09:00:00Z',
  isStale: false,
  staleReasons: [],
  staleAfter: '2026-09-02T10:00:00Z',
  latestMessageAt: '2026-09-01T09:00:00Z',
  latestPipelineAt: '2026-09-01T09:00:00Z',
};

describe('SalePlanOfTheDayCard', () => {
  beforeEach(() => {
    fetchSalesDailyPlan.mockReset();
    enqueueSalesDailyPlanJob.mockReset();
    pollSalesDailyPlanJob.mockReset();
  });

  it('loads empty state and generates a plan on demand', async () => {
    fetchSalesDailyPlan.mockResolvedValue(null);
    enqueueSalesDailyPlanJob.mockResolvedValue({
      id: 'job-1',
      status: 'pending',
      errorMessage: null,
      planId: null,
      createdAt: '2026-09-01T10:00:00Z',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-09-01T10:00:00Z',
      queueWaitMs: null,
      durationMs: null,
      plan: null,
    });
    pollSalesDailyPlanJob.mockResolvedValue({
      id: 'job-1',
      status: 'succeeded',
      errorMessage: null,
      planId: 'plan-1',
      createdAt: '2026-09-01T10:00:00Z',
      startedAt: '2026-09-01T10:00:01Z',
      finishedAt: '2026-09-01T10:00:08Z',
      updatedAt: '2026-09-01T10:00:08Z',
      queueWaitMs: 1000,
      durationMs: 7000,
      plan: samplePlan,
    });

    const user = userEvent.setup();
    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Generate insight' }));

    await waitFor(() => {
      expect(screen.getByText('Close Family Consultation conversations.')).toBeInTheDocument();
    });
    expect(screen.getByText('Reply to Mei')).toBeInTheDocument();
    const leadLinks = screen.getAllByRole('link', { name: 'Open lead' });
    expect(leadLinks.length).toBeGreaterThan(0);
    expect(leadLinks[0]).toHaveAttribute('href', '/sales?lead=lead-1');
    expect(screen.getByText(/Last run: queue 1\.0 s · model 7\.0 s/i)).toBeInTheDocument();
    expect(enqueueSalesDailyPlanJob).toHaveBeenCalledTimes(1);
    expect(pollSalesDailyPlanJob).toHaveBeenCalledWith('job-1', expect.any(AbortSignal));
  });

  it('shows invoice links on payment follow-up priorities', async () => {
    fetchSalesDailyPlan.mockResolvedValue({
      ...samplePlan,
      priorities: [
        {
          title: 'Chase INV-1001',
          why: 'Balance overdue',
          action: 'Send a polite payment reminder.',
          leadId: null,
          invoiceId: 'inv-1001',
        },
      ],
      outreach: [],
    });

    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText('Chase INV-1001')).toBeInTheDocument();
    });
    const invoiceLink = screen.getByRole('link', { name: 'Open invoice' });
    expect(invoiceLink).toHaveAttribute(
      'href',
      '/finance?tab=client-invoices&invoice=inv-1001',
    );
  });

  it('shows a stale banner when the stored plan is outdated', async () => {
    fetchSalesDailyPlan.mockResolvedValue({
      ...samplePlan,
      id: 'plan-2',
      focus: 'Old advice',
      priorities: [],
      outreach: [],
      offerRefinements: [],
      risks: [],
      isStale: true,
      staleReasons: ['age', 'new_conversation', 'pipeline_changed'],
    });

    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText(/Plan may be stale/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/older than 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/newer conversation messages/i)).toBeInTheDocument();
    expect(screen.getByText(/pipeline activity since this plan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh insight' })).toBeInTheDocument();
  });

  it('shows a friendly message when generation hits a gateway timeout', async () => {
    fetchSalesDailyPlan.mockResolvedValue(null);
    enqueueSalesDailyPlanJob.mockRejectedValue(
      new AdminApiError({
        statusCode: 504,
        payload: { error: 'Gateway Timeout' },
        message: 'Gateway Timeout',
      })
    );

    const user = userEvent.setup();
    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Generate insight' }));

    await waitFor(() => {
      expect(screen.getByText(/The AI model took too long to respond/i)).toBeInTheDocument();
    });
  });
});

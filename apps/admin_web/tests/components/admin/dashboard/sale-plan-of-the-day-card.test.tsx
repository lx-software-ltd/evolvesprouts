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
  resetSalesDailyPlanMemory: vi.fn(),
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
  operatorInput: null,
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
    fetchSalesDailyPlan.mockResolvedValue({ plan: null, memory: [] });
    enqueueSalesDailyPlanJob.mockResolvedValue({
      id: 'job-1',
      status: 'pending',
      errorMessage: null,
      operatorInput: null,
      planId: null,
      createdAt: '2026-09-01T10:00:00Z',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-09-01T10:00:00Z',
      queueWaitMs: null,
      durationMs: null,
      plan: null,
    });
    pollSalesDailyPlanJob.mockImplementation(async () => {
      fetchSalesDailyPlan.mockResolvedValue({
        plan: samplePlan,
        memory: [
          {
            id: samplePlan.id,
            generatedAt: samplePlan.generatedAt,
            focus: samplePlan.focus,
            productFocus: samplePlan.productFocus,
            operatorInput: samplePlan.operatorInput,
          },
        ],
      });
      return {
        id: 'job-1',
        status: 'succeeded',
        errorMessage: null,
        operatorInput: null,
        planId: 'plan-1',
        createdAt: '2026-09-01T10:00:00Z',
        startedAt: '2026-09-01T10:00:01Z',
        finishedAt: '2026-09-01T10:00:08Z',
        updatedAt: '2026-09-01T10:00:08Z',
        queueWaitMs: 1000,
        durationMs: 7000,
        plan: samplePlan,
      };
    });

    const user = userEvent.setup();
    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText(/No plan yet/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/every morning at 6:00 HKT/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Generate insight' }));

    await waitFor(() => {
      expect(screen.getByText('Close Family Consultation conversations.')).toBeInTheDocument();
    });
    expect(screen.getByText('Reply to Mei')).toBeInTheDocument();
    const leadLinks = screen.getAllByRole('link', { name: 'Open lead' });
    expect(leadLinks.length).toBeGreaterThan(0);
    expect(leadLinks[0]).toHaveAttribute('href', '/sales?lead=lead-1');
    expect(screen.getByText(/Last run: queue 1\.0 s · model 7\.0 s/i)).toBeInTheDocument();
    expect(enqueueSalesDailyPlanJob).toHaveBeenCalledWith(undefined);
    expect(pollSalesDailyPlanJob).toHaveBeenCalledWith('job-1', expect.any(AbortSignal));
  });

  it('shows invoice links on payment follow-up priorities', async () => {
    fetchSalesDailyPlan.mockResolvedValue({
      plan: {
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
      },
      memory: [],
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
      plan: {
        ...samplePlan,
        id: 'plan-2',
        focus: 'Old advice',
        priorities: [],
        outreach: [],
        offerRefinements: [],
        risks: [],
        isStale: true,
        staleReasons: ['age', 'new_conversation', 'pipeline_changed'],
      },
      memory: [
        {
          id: 'plan-2',
          generatedAt: '2026-09-01T10:00:00Z',
          focus: 'Old advice',
          productFocus: 'Push Family Consultations this week.',
          operatorInput: null,
        },
        {
          id: 'plan-older',
          generatedAt: '2026-08-31T10:00:00Z',
          focus: 'Earlier MBA push',
          productFocus: 'My Best Auntie',
          operatorInput: 'Lean into helper training',
        },
      ],
    });

    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByText(/Plan may be stale/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/older than 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/newer conversation messages/i)).toBeInTheDocument();
    expect(screen.getByText(/pipeline activity since this plan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh insight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous insights/i })).toBeInTheDocument();
  });

  it('shows a friendly message when generation hits a gateway timeout', async () => {
    fetchSalesDailyPlan.mockResolvedValue({ plan: null, memory: [] });
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

  it('sends the refinement box with refresh insight', async () => {
    fetchSalesDailyPlan.mockResolvedValue({
      plan: samplePlan,
      memory: [
        {
          id: samplePlan.id,
          generatedAt: samplePlan.generatedAt,
          focus: samplePlan.focus,
          productFocus: samplePlan.productFocus,
          operatorInput: null,
        },
      ],
    });
    enqueueSalesDailyPlanJob.mockResolvedValue({
      id: 'job-2',
      status: 'pending',
      errorMessage: null,
      operatorInput: 'Focus on MBA this week',
      planId: null,
      createdAt: '2026-09-01T11:00:00Z',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-09-01T11:00:00Z',
      queueWaitMs: null,
      durationMs: null,
      plan: null,
    });
    pollSalesDailyPlanJob.mockImplementation(async () => {
      const nextPlan = { ...samplePlan, operatorInput: 'Focus on MBA this week' };
      fetchSalesDailyPlan.mockResolvedValue({
        plan: nextPlan,
        memory: [
          {
            id: nextPlan.id,
            generatedAt: nextPlan.generatedAt,
            focus: nextPlan.focus,
            productFocus: nextPlan.productFocus,
            operatorInput: nextPlan.operatorInput,
          },
        ],
      });
      return {
        id: 'job-2',
        status: 'succeeded',
        errorMessage: null,
        operatorInput: 'Focus on MBA this week',
        planId: 'plan-1',
        createdAt: '2026-09-01T11:00:00Z',
        startedAt: '2026-09-01T11:00:01Z',
        finishedAt: '2026-09-01T11:00:08Z',
        updatedAt: '2026-09-01T11:00:08Z',
        queueWaitMs: 1000,
        durationMs: 7000,
        plan: nextPlan,
      };
    });

    const user = userEvent.setup();
    render(<SalePlanOfTheDayCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh insight' })).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText('Refinement for next insight'),
      'Focus on MBA this week'
    );
    await user.click(screen.getByRole('button', { name: 'Refresh insight' }));

    await waitFor(() => {
      expect(enqueueSalesDailyPlanJob).toHaveBeenCalledWith('Focus on MBA this week');
    });
  });
});

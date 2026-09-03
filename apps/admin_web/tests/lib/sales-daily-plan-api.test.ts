import { describe, expect, it } from 'vitest';

import { parseSalesDailyPlan } from '@/lib/sales-daily-plan-api';

describe('parseSalesDailyPlan', () => {
  it('maps snake_case API payloads into the view model', () => {
    const plan = parseSalesDailyPlan({
      id: 'plan-1',
      focus: 'Close consults',
      priorities: [
        {
          title: 'Call Mei',
          why: 'Qualified',
          action: 'Book a slot',
          lead_id: 'lead-1',
          invoice_id: 'inv-1',
        },
      ],
      outreach: [
        {
          channel: 'whatsapp',
          lead_id: 'lead-1',
          message_excerpt: 'When?',
          draft_reply: 'Tue or Thu?',
          rationale: 'Offer two slots',
        },
      ],
      product_focus: 'Family Consultations',
      offer_refinements: ['Tighten CTA'],
      risks: ['No invented prices'],
      generated_at: '2026-09-01T10:00:00Z',
      generated_by: 'user-1',
      model: 'test-model',
      conversation_watermark_at: '2026-09-01T09:00:00Z',
      pipeline_watermark_at: '2026-09-01T09:30:00Z',
      is_stale: true,
      stale_reasons: ['age', 'pipeline_changed'],
      stale_after: '2026-09-02T10:00:00Z',
      latest_message_at: null,
      latest_pipeline_at: '2026-09-01T11:00:00Z',
    });

    expect(plan).toMatchObject({
      id: 'plan-1',
      focus: 'Close consults',
      productFocus: 'Family Consultations',
      isStale: true,
      staleReasons: ['age', 'pipeline_changed'],
    });
    expect(plan?.priorities[0]?.leadId).toBe('lead-1');
    expect(plan?.priorities[0]?.invoiceId).toBe('inv-1');
    expect(plan?.outreach[0]?.draftReply).toBe('Tue or Thu?');
  });

  it('returns null for non-objects', () => {
    expect(parseSalesDailyPlan(null)).toBeNull();
    expect(parseSalesDailyPlan('nope')).toBeNull();
  });
});

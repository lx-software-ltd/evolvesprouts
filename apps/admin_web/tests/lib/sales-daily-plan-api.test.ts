import { describe, expect, it } from 'vitest';

import {
  parseSalesDailyPlan,
  parseSalesDailyPlanSnapshot,
} from '@/lib/sales-daily-plan-api';

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
          kind: 'book',
          urgency: 1,
          sources: ['lead'],
          lead_id: 'lead-1',
          invoice_id: 'inv-1',
          conversation_id: null,
          assigned_to: 'user-1',
          item_key: 'Call Mei\nlead-1\ninv-1',
          done: true,
          feedback: 'up',
          compare_status: 'new',
        },
      ],
      outreach: [
        {
          channel: 'whatsapp',
          lead_id: 'lead-1',
          conversation_id: 'conv-1',
          assigned_to: 'user-1',
          message_excerpt: 'When?',
          draft_reply: 'Tue or Thu?',
          rationale: 'Offer two slots',
          item_key: 'whatsapp\nlead-1\nconv-1\nWhen?',
        },
      ],
      product_focus: 'Family Consultations',
      offer_refinements: ['Tighten CTA'],
      risks: ['No invented prices'],
      generated_at: '2026-09-01T10:00:00Z',
      generated_by: 'user-1',
      generated_by_name: 'Ida',
      model: 'test-model',
      operator_input: 'Focus on MBA',
      conversation_watermark_at: '2026-09-01T09:00:00Z',
      pipeline_watermark_at: '2026-09-01T09:30:00Z',
      is_stale: true,
      stale_reasons: ['age', 'pipeline_changed'],
      stale_counts: { new_conversation: 0, pipeline_changed: 2, contacts_changed: 0 },
      stale_after: '2026-09-02T10:00:00Z',
      latest_message_at: null,
      latest_pipeline_at: '2026-09-01T11:00:00Z',
      latest_contact_at: '2026-09-01T11:30:00Z',
    });

    expect(plan).toMatchObject({
      id: 'plan-1',
      focus: 'Close consults',
      productFocus: 'Family Consultations',
      isStale: true,
      staleReasons: ['age', 'pipeline_changed'],
      operatorInput: 'Focus on MBA',
    });
    expect(plan?.priorities[0]?.leadId).toBe('lead-1');
    expect(plan?.priorities[0]?.invoiceId).toBe('inv-1');
    expect(plan?.priorities[0]?.kind).toBe('book');
    expect(plan?.priorities[0]?.done).toBe(true);
    expect(plan?.staleCounts.pipelineChanged).toBe(2);
    expect(plan?.outreach[0]?.conversationId).toBe('conv-1');
    expect(plan?.generatedByName).toBe('Ida');
    expect(plan?.latestContactAt).toBe('2026-09-01T11:30:00Z');
    expect(plan?.outreach[0]?.draftReply).toBe('Tue or Thu?');
    expect(plan?.suppressedItems).toEqual([]);
    expect(plan?.priorities[0]?.fromInstruction).toBe(false);
  });

  it('returns null for non-objects', () => {
    expect(parseSalesDailyPlan(null)).toBeNull();
    expect(parseSalesDailyPlan('nope')).toBeNull();
  });

  it('parses the GET snapshot including memory', () => {
    const snapshot = parseSalesDailyPlanSnapshot({
      plan: { id: 'plan-1', focus: 'Close consults' },
      memory: [
        {
          id: 'plan-1',
          generated_at: '2026-09-01T10:00:00Z',
          focus: 'Close consults',
          product_focus: 'Family Consultations',
          operator_input: 'Focus on MBA',
        },
      ],
      job: {
        id: 'job-1',
        status: 'failed',
        error_message: 'The AI returned an invalid response. Please try again.',
      },
    });
    expect(snapshot.plan?.id).toBe('plan-1');
    expect(snapshot.memory).toEqual([
      {
        id: 'plan-1',
        generatedAt: '2026-09-01T10:00:00Z',
        focus: 'Close consults',
        productFocus: 'Family Consultations',
        operatorInput: 'Focus on MBA',
        priorities: [],
      },
    ]);
    expect(snapshot.job?.status).toBe('failed');
    expect(snapshot.job?.errorMessage).toBe(
      'The AI returned an invalid response. Please try again.',
    );
    expect(snapshot.instructions).toEqual([]);
  });

  it('parses instructions and suppressed items', () => {
    const snapshot = parseSalesDailyPlanSnapshot({
      plan: {
        id: 'plan-1',
        focus: 'Close consults',
        suppressed_items: [
          {
            title: 'Call Sam',
            item_key: 'title:call sam',
            item_kind: 'priority',
            reason: 'done_today',
          },
        ],
        priorities: [
          {
            title: 'Call the venue',
            from_instruction: true,
            instruction_id: 'instr-1',
            resurfaced: false,
          },
        ],
      },
      instructions: [
        {
          id: 'instr-1',
          text: 'Call the venue about Thursday',
          scope: 'today',
          active_until: '2026-09-04T22:00:00Z',
        },
      ],
    });
    expect(snapshot.instructions[0]?.scope).toBe('today');
    expect(snapshot.plan?.suppressedItems[0]?.reason).toBe('done_today');
    expect(snapshot.plan?.priorities[0]?.fromInstruction).toBe(true);
    expect(snapshot.plan?.priorities[0]?.instructionId).toBe('instr-1');
  });
});

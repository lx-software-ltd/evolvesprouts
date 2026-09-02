'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { StatusBanner } from '@/components/status-banner';
import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { Button } from '@/components/ui/button';
import { AdminApiError } from '@/lib/api-admin-client';
import {
  enqueueLeadAiSuggestionJob,
  fetchLeadAiSuggestion,
  pollLeadAiSuggestionJob,
} from '@/lib/leads-api';
import type { LeadAiSuggestion, LeadAiSuggestionJob } from '@/types/leads';

export interface LeadAiSuggestionPanelProps {
  leadId: string;
}

function formatStaleReasons(reasons: string[]): string {
  return reasons
    .map((reason) => {
      if (reason === 'age') {
        return 'older than 24 hours';
      }
      if (reason === 'new_conversation') {
        return 'newer conversation messages';
      }
      return reason;
    })
    .join('; ');
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatLeadAiSuggestionError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    if (error.statusCode === 502 || error.statusCode === 504) {
      return 'The AI model took too long to respond. Please try again in a moment.';
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

export function LeadAiSuggestionPanel({ leadId }: LeadAiSuggestionPanelProps) {
  const [suggestion, setSuggestion] = useState<LeadAiSuggestion | null>(null);
  const [lastJob, setLastJob] = useState<LeadAiSuggestionJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadSuggestion = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const next = await fetchLeadAiSuggestion(leadId);
      setSuggestion(next);
    } catch (loadError) {
      setError(formatLeadAiSuggestionError(loadError, 'Failed to load AI suggestion.'));
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void loadSuggestion();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadSuggestion]);

  async function handleGenerate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setError('');
    setLastJob(null);
    try {
      const queued = await enqueueLeadAiSuggestionJob(leadId);
      setLastJob(queued);
      const finished = await pollLeadAiSuggestionJob(leadId, queued.id, controller.signal);
      setLastJob(finished);
      if (finished.suggestion) {
        setSuggestion(finished.suggestion);
      } else {
        await loadSuggestion();
      }
    } catch (generateError) {
      if (generateError instanceof DOMException && generateError.name === 'AbortError') {
        return;
      }
      setError(
        formatLeadAiSuggestionError(generateError, 'Failed to generate AI suggestion.')
      );
    } finally {
      setIsGenerating(false);
    }
  }

  const primaryLabel = suggestion ? 'Refresh suggestion' : 'Generate suggestion';
  const busy = isLoading || isGenerating;

  return (
    <AdminEditorCard
      title='AI Suggestion'
      description='Advisor comment on how to close this lead, including message-specific follow-ups. Suggestions are not sent automatically.'
      actions={
        <Button type='button' onClick={() => void handleGenerate()} disabled={busy}>
          {isGenerating ? 'Generating…' : primaryLabel}
        </Button>
      }
    >
      {error ? (
        <StatusBanner variant='error' title='AI suggestion'>
          {error}
        </StatusBanner>
      ) : null}

      {isGenerating ? (
        <p className='text-sm text-slate-600'>
          Generating suggestion
          {lastJob?.status ? ` (${lastJob.status})` : ''}…
        </p>
      ) : null}

      {lastJob && (lastJob.status === 'succeeded' || lastJob.status === 'failed') ? (
        <p className='text-xs text-slate-500'>
          Last run: queue {formatDuration(lastJob.queueWaitMs)} · model{' '}
          {formatDuration(lastJob.durationMs)}
          {lastJob.finishedAt
            ? ` · finished ${new Date(lastJob.finishedAt).toLocaleString()}`
            : ''}
        </p>
      ) : null}

      {isLoading ? <p className='text-sm text-slate-600'>Loading suggestion…</p> : null}

      {!isLoading && !suggestion ? (
        <p className='text-sm text-slate-600'>
          No suggestion yet. Generate one to get closing advice based on Evolve Sprouts context,
          this lead, and similar closed leads.
        </p>
      ) : null}

      {!isLoading && suggestion ? (
        <div className='space-y-4'>
          {suggestion.isStale ? (
            <StatusBanner variant='info' title='Suggestion may be stale'>
              {`This suggestion looks out of date (${formatStaleReasons(suggestion.staleReasons)}). Refresh to regenerate.`}
            </StatusBanner>
          ) : null}

          <div>
            <h3 className='text-sm font-medium text-slate-900'>Summary</h3>
            <p className='mt-1 whitespace-pre-wrap text-sm text-slate-700'>
              {suggestion.summary || '—'}
            </p>
          </div>

          {suggestion.actions.length > 0 ? (
            <div>
              <h3 className='text-sm font-medium text-slate-900'>Suggested actions</h3>
              <ul className='mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700'>
                {suggestion.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestion.followUps.length > 0 ? (
            <div className='space-y-3'>
              <h3 className='text-sm font-medium text-slate-900'>Message follow-ups</h3>
              {suggestion.followUps.map((followUp, index) => (
                <div
                  key={`${followUp.channel}-${index}`}
                  className='space-y-1 border-t border-slate-200 pt-3 first:border-t-0 first:pt-0'
                >
                  <p className='text-xs font-medium uppercase tracking-wide text-slate-500'>
                    {followUp.channel}
                  </p>
                  {followUp.messageExcerpt ? (
                    <p className='text-sm text-slate-600'>Re: “{followUp.messageExcerpt}”</p>
                  ) : null}
                  <p className='whitespace-pre-wrap text-sm text-slate-700'>
                    {followUp.draftReply || '—'}
                  </p>
                  {followUp.rationale ? (
                    <p className='text-xs text-slate-500'>{followUp.rationale}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {suggestion.risks.length > 0 ? (
            <div>
              <h3 className='text-sm font-medium text-slate-900'>Risks / cautions</h3>
              <ul className='mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700'>
                {suggestion.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className='text-xs text-slate-500'>
            Generated{' '}
            {suggestion.generatedAt ? new Date(suggestion.generatedAt).toLocaleString() : '—'}
            {suggestion.staleAfter
              ? ` · Age-stale after ${new Date(suggestion.staleAfter).toLocaleString()}`
              : ''}
          </p>
        </div>
      ) : null}
    </AdminEditorCard>
  );
}

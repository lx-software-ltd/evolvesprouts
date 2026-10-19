'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getLead } from '@/lib/leads-api';
import type { LeadDetail, LeadEvent, LeadNote } from '@/types/leads';
import { toErrorMessage } from './hook-errors';

export function useLeadDetail(leadId: string | null) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const latestRequestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!leadId) {
      setLead(null);
      setEvents([]);
      setNotes([]);
      setError('');
      setIsLoading(false);
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsLoading(true);
    setError('');
    try {
      const detail = await getLead(leadId);
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setLead(detail);
      setEvents(detail?.events ?? []);
      setNotes(detail?.notes ?? []);
    } catch (err) {
      if (latestRequestIdRef.current !== requestId) {
        return;
      }
      setError(toErrorMessage(err, 'Failed to load lead detail.'));
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset or load when inputs change
    void refetch();
  }, [refetch]);

  return { lead, events, notes, isLoading, error, refetch };
}

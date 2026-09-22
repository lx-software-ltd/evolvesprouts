'use client';

import { useEffect, useRef, useState } from 'react';

import { ButtonPrimitive } from '@/components/shared/button-primitive';
import { trackAnalyticsEvent } from '@/lib/analytics';

const COPIED_RESET_MS = 2000;

interface BookingShareLinkButtonProps {
  url: string;
  copyLinkLabel: string;
  copyLinkCopiedLabel: string;
  copyLinkFallbackLabel: string;
  copyLinkCopiedAnnouncement: string;
  serviceTier: string;
  cohortLabel: string;
  analyticsSectionId: string;
}

export function BookingShareLinkButton({
  url,
  copyLinkLabel,
  copyLinkCopiedLabel,
  copyLinkFallbackLabel,
  copyLinkCopiedAnnouncement,
  serviceTier,
  cohortLabel,
  analyticsSectionId,
}: BookingShareLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showFallback) {
      return;
    }
    fallbackInputRef.current?.focus();
    fallbackInputRef.current?.select();
  }, [showFallback, url]);

  if (!url) {
    return null;
  }

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is unavailable.');
      }
      await navigator.clipboard.writeText(url);
      setShowFallback(false);
      setCopied(true);
      trackAnalyticsEvent('booking_share_link_copied', {
        sectionId: analyticsSectionId,
        ctaLocation: 'payment_modal',
        params: {
          service_tier: serviceTier,
          cohort_label: cohortLabel,
        },
      });
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, COPIED_RESET_MS);
    } catch {
      setCopied(false);
      setShowFallback(true);
    }
  }

  return (
    <div className={showFallback ? 'min-w-0 flex-1' : undefined}>
      <div className='flex justify-end'>
        <ButtonPrimitive
          variant='primary'
          className='es-btn--outline h-10 gap-2 px-4 text-sm'
          onClick={() => {
            void handleCopy();
          }}
        >
          <span
            className={`${copied ? 'es-mask-check-current' : 'es-mask-copy-current'} h-4 w-4 shrink-0`}
            aria-hidden='true'
          />
          {copied ? copyLinkCopiedLabel : copyLinkLabel}
        </ButtonPrimitive>
      </div>
      {showFallback ? (
        <label className='mt-2 block text-left text-sm es-text-heading'>
          {copyLinkFallbackLabel}
          <input
            ref={fallbackInputRef}
            readOnly
            value={url}
            className='es-focus-ring es-form-input mt-1 w-full'
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </label>
      ) : null}
      <p className='sr-only' role='status' aria-live='polite'>
        {copied ? copyLinkCopiedAnnouncement : ''}
      </p>
    </div>
  );
}

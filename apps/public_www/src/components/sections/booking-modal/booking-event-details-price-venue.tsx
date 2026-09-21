import { Fragment } from 'react';

import { ExternalLinkInlineContent } from '@/components/shared/external-link-icon';
import { SmartLink } from '@/components/shared/smart-link';
import type { BookingPaymentModalContent, Locale } from '@/content';
import { formatCurrencyHkd } from '@/lib/format';
import { getHrefKind } from '@/lib/url-utils';

interface BookingEventDetailsPriceVenueProps {
  locale: Locale;
  content: BookingPaymentModalContent;
  originalAmount: number;
  venueName: string;
  venueAddress: string;
  directionHref?: string;
  /** When true, top border uses `py-8` on price block (event variant spacing). */
  isEventSpacing?: boolean;
  /**
   * When true, omit the outer `section` and top margin (parent already provides
   * `border-t` / spacing - e.g. event column with schedule or consultation picker above).
   */
  embedded?: boolean;
}

export function BookingEventDetailsPriceVenue({
  locale,
  content,
  originalAmount,
  venueName,
  venueAddress,
  directionHref = '',
  isEventSpacing = false,
  embedded = false,
}: BookingEventDetailsPriceVenueProps) {
  const showDirectionsLink = getHrefKind(directionHref.trim()) === 'http';
  const isFreePrice = originalAmount <= 0;

  const inner = (
    <Fragment>
      <div
        className={
          isEventSpacing
            ? 'border-b border-black/15 py-8'
            : 'border-b border-black/15 pb-8'
        }
      >
        <div className='flex items-start gap-4'>
          <span className='es-icon-circle-lg'>
            <span
              className={
                isFreePrice
                  ? 'es-mask-dollar-success h-[46px] w-[46px] shrink-0'
                  : 'es-mask-dollar-danger h-[46px] w-[46px] shrink-0'
              }
              aria-hidden='true'
            />
          </span>
          <div>
            <p
              className={
                isFreePrice
                  ? 'text-[26px] font-bold leading-none es-text-success'
                  : 'text-[26px] font-bold leading-none es-text-heading'
              }
            >
              {isFreePrice ? content.priceBreakdownFreeLabel : formatCurrencyHkd(originalAmount, locale)}
            </p>
            {isFreePrice ? null : (
              <p className='mt-4 text-base font-semibold leading-6 es-text-heading'>
                {content.refundHint}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className='pb-8 pt-8'>
        <div className='flex items-start gap-4'>
          <span className='es-icon-circle-lg'>
            <span
              className='es-mask-location-danger h-[46px] w-[46px] shrink-0'
              aria-hidden='true'
            />
          </span>
          <div>
            {venueName ? (
              <p className='text-lg font-semibold leading-6 es-text-heading'>
                {venueName}
              </p>
            ) : null}
            {venueAddress ? (
              <p className='mt-1 text-base font-semibold leading-6 es-text-heading'>
                {venueAddress}
              </p>
            ) : null}
            {showDirectionsLink ? (
              <SmartLink
                href={directionHref.trim()}
                className='mt-3 inline-flex items-center text-base font-semibold leading-none es-text-heading'
              >
                {({ isExternalHttp }) => (
                  <ExternalLinkInlineContent
                    isExternalHttp={isExternalHttp}
                    externalLabelClassName='es-link-external-label--direction'
                  >
                    {content.directionLabel}
                  </ExternalLinkInlineContent>
                )}
              </SmartLink>
            ) : null}
          </div>
        </div>
      </div>
    </Fragment>
  );

  if (embedded) {
    return inner;
  }

  return (
    <section className='mt-9 border-t border-black/15 pt-8'>
      {inner}
    </section>
  );
}

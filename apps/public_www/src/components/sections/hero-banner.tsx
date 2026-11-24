import { preload } from 'react-dom';

import { SectionCtaAnchor } from '@/components/sections/shared/section-cta-link';
import {
  buildSectionSplitLayoutClassName,
  SectionContainer,
} from '@/components/sections/shared/section-container';
import { SectionHeader } from '@/components/sections/shared/section-header';
import {
  renderHighlightedText,
  renderQuotedDescriptionText,
} from '@/components/sections/shared/render-highlighted-text';
import { SectionShell } from '@/components/sections/shared/section-shell';
import { resolveHeroCopy } from '@/content/copy-normalizers';
import type { HeroContent } from '@/content';
import { ROUTES } from '@/lib/routes';

interface HeroBannerProps {
  content: HeroContent;
  ctaHref?: string;
}

const HERO_IMAGE_SRC = '/images/hero/child-hero.webp';
const HERO_FRAME_SRC = '/images/evolvesprouts-logo.svg';
const HERO_BODY_TEXT_CLASSNAME = 'max-w-[458px] es-hero-subheadline';

export function HeroBanner({ content, ctaHref }: HeroBannerProps) {
  preload(HERO_IMAGE_SRC, { as: 'image', fetchPriority: 'high' });
  const copy = resolveHeroCopy(content);
  const resolvedCtaHref =
    ctaHref?.trim()
    || content.ctaHref?.trim()
    || ROUTES.servicesMyBestAuntieTrainingCourse;

  return (
    <SectionShell
      id='hero-banner'
      ariaLabel={copy.title}
      dataFigmaNode='hero-banner'
      className='relative w-full overflow-hidden es-hero-section'
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HERO_FRAME_SRC}
        alt=''
        width={1125}
        height={563}
        aria-hidden='true'
        decoding='async'
        fetchPriority='low'
        className='pointer-events-none absolute left-0 top-0 es-hero-frame-bg'
      />
      <SectionContainer
        className={buildSectionSplitLayoutClassName(
          'es-section-split-layout--hero items-center',
        )}
      >
        <div className='relative max-w-[620px] lg:pb-4 lg:pr-8'>
          <div className='relative z-10'>
            <SectionHeader
              title={renderHighlightedText(copy.title, content.highlightPhrase)}
              titleAs='h1'
              align='left'
              className='max-w-[610px]'
              titleClassName='es-hero-headline'
              description={copy.subtitle}
              descriptionClassName={`mt-4 sm:mt-6 ${HERO_BODY_TEXT_CLASSNAME}`}
            />
            <SectionCtaAnchor
              href={resolvedCtaHref}
              className='mt-6'
            >
              {content.cta}
            </SectionCtaAnchor>
            <p className={`mt-4 ${HERO_BODY_TEXT_CLASSNAME}`}>
              {renderQuotedDescriptionText(copy.description)}
            </p>
          </div>
        </div>
        <div className='mx-auto w-full max-w-[573px] lg:ml-auto lg:mr-0'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={HERO_IMAGE_SRC}
            alt={content.imageAlt}
            width={764}
            height={841}
            decoding='sync'
            fetchPriority='high'
            className='h-auto w-full'
          />
        </div>
      </SectionContainer>
    </SectionShell>
  );
}

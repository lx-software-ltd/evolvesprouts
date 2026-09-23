import Image from 'next/image';

import { SectionContainer } from '@/components/sections/shared/section-container';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { SectionShell } from '@/components/sections/shared/section-shell';
import { renderQuotedDescriptionText } from '@/components/sections/shared/render-highlighted-text';
import type { AboutUsFounderCoachContent } from '@/content';

interface AboutUsFounderCoachProps {
  content: AboutUsFounderCoachContent;
  ariaLabel?: string;
}

function splitDescriptionParagraphs(description: string): string[] {
  return description
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function AboutUsFounderCoach({
  content,
  ariaLabel,
}: AboutUsFounderCoachProps) {
  const descriptionParagraphs = splitDescriptionParagraphs(content.description);

  return (
    <SectionShell
      id='about-us-founder-coach'
      ariaLabel={ariaLabel ?? content.title}
      dataFigmaNode='about-us-founder-coach'
      className='es-section-bg-overlay es-about-us-founder-coach-section'
    >
      <SectionContainer className='grid gap-8 lg:grid-cols-[minmax(0,20%)_minmax(0,80%)] lg:items-start'>
        <div className='mx-auto w-full max-w-[220px] lg:mx-0 lg:max-w-[190px]'>
          <div className='aspect-square overflow-hidden rounded-full border-4 es-border-soft es-bg-surface-soft'>
            <Image
              src='/images/about-us/founder-portrait-1.webp'
              alt={content.imageAlt}
              width={560}
              height={560}
              sizes='(max-width: 1024px) 220px, 190px'
              className='h-full w-full origin-top scale-[2] object-cover object-top'
            />
          </div>
        </div>
        <div>
          <SectionHeader
            eyebrow={content.eyebrow}
            title={content.title}
            align='left'
          />
          <p className='mt-3 es-type-subtitle es-about-us-founder-coach-subtitle'>
            {content.subtitle}
          </p>
          <div className='mt-5 space-y-4'>
            {descriptionParagraphs.map((paragraph, index) => (
              <p
                key={`${paragraph}-${index}`}
                className='es-type-body es-about-us-founder-coach-description'
              >
                {renderQuotedDescriptionText(
                  paragraph,
                  content.highlightedPhrase,
                )}
              </p>
            ))}
          </div>
          <ul className='mt-6 flex flex-wrap gap-2.5 sm:gap-3'>
            {content.tags.map((tag) => (
              <li key={tag}>
                <span className='inline-flex rounded-full border px-4 py-2 text-sm font-semibold es-bg-surface-white es-border-soft es-text-heading'>
                  {tag}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SectionContainer>
    </SectionShell>
  );
}

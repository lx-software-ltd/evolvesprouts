import Image from 'next/image';
import { Fragment } from 'react';

import {
  buildSectionSplitLayoutClassName,
  SectionContainer,
} from '@/components/sections/shared/section-container';
import { renderQuotedDescriptionText } from '@/components/sections/shared/render-highlighted-text';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { SectionShell } from '@/components/sections/shared/section-shell';
import type { AboutUsMyHistoryContent } from '@/content';
import { formatContentTemplate } from '@/content/content-field-utils';

interface AboutUsMyHistoryProps {
  content: AboutUsMyHistoryContent;
}

function buildMobileImageAnchorIndexes(
  paragraphCount: number,
  imageCount: number,
): number[] {
  if (paragraphCount === 0 || imageCount === 0) {
    return [];
  }

  const lastParagraphIndex = paragraphCount - 1;

  return Array.from({ length: imageCount }, (_item, index) => {
    const anchorIndex =
      Math.ceil(((index + 1) * (paragraphCount + 1)) / (imageCount + 1)) - 1;
    return Math.min(lastParagraphIndex, Math.max(0, anchorIndex));
  });
}

export function AboutUsMyHistory({ content }: AboutUsMyHistoryProps) {
  const storyParagraphs = content.description
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const storyImageSources = [
    '/images/about-us/founder-ims.webp',
    '/images/about-us/founder-my-best-auntie-1.webp',
    '/images/about-us/founder-my-best-auntie-2.webp',
  ];
  const mobileImageAnchorIndexes = buildMobileImageAnchorIndexes(
    storyParagraphs.length,
    storyImageSources.length,
  );
  const mobileImageIndexesByParagraph = mobileImageAnchorIndexes.reduce<
    Record<number, number[]>
  >((accumulator, anchorIndex, imageIndex) => {
    const existingImageIndexes = accumulator[anchorIndex] ?? [];
    existingImageIndexes.push(imageIndex);
    accumulator[anchorIndex] = existingImageIndexes;
    return accumulator;
  }, {});

  return (
    <SectionShell
      id='about-us-my-history'
      ariaLabel={content.title}
      dataFigmaNode='about-us-my-history'
      className='es-section-bg-overlay es-my-history-section'
    >
      <SectionContainer
        className={buildSectionSplitLayoutClassName(
          'es-section-split-layout--my-history items-center',
        )}
      >
        <div>
          <SectionHeader
            eyebrow={content.eyebrow}
            title={content.title}
            align='left'
            titleClassName='max-w-[780px]'
            description={content.subtitle}
            descriptionClassName='es-type-subtitle mt-4 max-w-[760px]'
          />
          {storyParagraphs.map((paragraph, paragraphIndex) => {
            const imageIndexesForParagraph =
              mobileImageIndexesByParagraph[paragraphIndex] ?? [];

            return (
              <Fragment key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>
                <p className='es-type-body mt-4 max-w-[760px]'>
                  {renderQuotedDescriptionText(paragraph)}
                </p>
                {imageIndexesForParagraph.map((imageIndex) => {
                  const src = storyImageSources[imageIndex];

                  return (
                    <Image
                      key={`${src}-mobile`}
                      src={src}
                      alt={formatContentTemplate(content.imageAltTemplate, {
                        index: imageIndex + 1,
                      })}
                      width={1600}
                      height={1200}
                      sizes='100vw'
                      className='mt-4 h-auto w-full rounded-card-sm border es-border-warm-3 brightness-[1.1] contrast-[1.15] saturate-[1.05] lg:hidden'
                    />
                  );
                })}
              </Fragment>
            );
          })}
        </div>

        <div className='hidden flex-col gap-4 lg:ml-auto lg:flex lg:max-w-[651px] lg:p-[60px]'>
          {storyImageSources.map((src, index) => (
            <Image
              key={src}
              src={src}
              alt={formatContentTemplate(content.imageAltTemplate, {
                index: index + 1,
              })}
              width={1600}
              height={1200}
              sizes='(min-width: 1280px) 651px, (min-width: 1024px) 44vw, 100vw'
              className='h-auto w-full rounded-card-sm border es-border-warm-3 brightness-[1.1] contrast-[1.15] saturate-[1.05]'
            />
          ))}
        </div>
      </SectionContainer>
    </SectionShell>
  );
}

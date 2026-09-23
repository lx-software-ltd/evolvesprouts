import Image from 'next/image';

import {
  buildSectionSplitLayoutClassName,
  SectionContainer,
} from '@/components/sections/shared/section-container';
import { renderQuotedDescriptionText } from '@/components/sections/shared/render-highlighted-text';
import { SectionHeader } from '@/components/sections/shared/section-header';
import { SectionShell } from '@/components/sections/shared/section-shell';
import type { AboutUsHeroContent } from '@/content';

interface AboutUsHeroProps {
  content: AboutUsHeroContent;
}

export function AboutUsHero({ content }: AboutUsHeroProps) {
  const description = content.description.trim();

  return (
    <SectionShell
      id='about-us-hero'
      ariaLabel={content.title}
      dataFigmaNode='about-us-hero'
      className='es-ida-section overflow-hidden pt-0 sm:pt-[60px]'
    >
      <SectionContainer
        className={buildSectionSplitLayoutClassName(
          'es-section-split-layout--ida items-center',
        )}
      >
        <div className='order-1 relative z-10 lg:order-2 lg:pl-8 xl:pl-[110px]'>
          <SectionHeader
            title={content.title}
            titleAs='h1'
            align='left'
            description={content.subtitle}
            descriptionClassName='es-type-subtitle mt-4 max-w-[760px]'
          />
          {description ? (
            <p className='es-type-body mt-4 max-w-[720px]'>
              {renderQuotedDescriptionText(description)}
            </p>
          ) : null}
        </div>

        <div className='order-2 lg:order-1'>
          <div className='w-full lg:ml-[-75px] lg:mr-[-38px] lg:w-[525px] xl:ml-[-135px] xl:mr-[-150px] xl:w-[833px]'>
            <Image
              src='/images/about-us/founder-portrait-1.webp'
              alt={content.imageAlt}
              width={1112}
              height={840}
              sizes='(min-width: 1280px) 1111px, (min-width: 1024px) 700px, 100vw'
              className='h-auto w-full'
            />
          </div>
        </div>
      </SectionContainer>
    </SectionShell>
  );
}

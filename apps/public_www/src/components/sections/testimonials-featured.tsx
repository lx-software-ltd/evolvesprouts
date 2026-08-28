import { SectionContainer } from '@/components/sections/shared/section-container';
import { SectionShell } from '@/components/sections/shared/section-shell';
import type { TestimonialsFeaturedContent } from '@/content';

interface TestimonialsFeaturedProps {
  content: TestimonialsFeaturedContent;
}

export function TestimonialsFeatured({ content }: TestimonialsFeaturedProps) {
  return (
    <SectionShell
      id='testimonials-featured'
      ariaLabel={content.sectionLabel}
      dataFigmaNode='testimonials-featured'
      className='es-section-bg-overlay es-testimonials-featured-section'
    >
      <SectionContainer>
        <figure
          data-testid='testimonials-featured-card'
          className='es-testimonials-featured-card mx-auto w-full max-w-[760px]'
        >
          <span
            aria-hidden='true'
            className='es-testimonial-quote-icon h-9 w-9 sm:h-11 sm:w-11'
          />
          <blockquote>
            <p className='es-testimonials-quote mt-4 text-balance sm:mt-5'>
              {content.quote}
            </p>
          </blockquote>
          <figcaption className='mt-6 text-center sm:mt-8'>
            <p className='es-testimonials-author'>{content.author}</p>
            <p className='es-testimonials-meta mt-1'>{content.service}</p>
          </figcaption>
        </figure>
      </SectionContainer>
    </SectionShell>
  );
}

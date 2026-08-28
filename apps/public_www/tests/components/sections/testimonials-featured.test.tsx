import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestimonialsFeatured } from '@/components/sections/testimonials-featured';
import enContent from '@/content/en.json';
import zhCNContent from '@/content/zh-CN.json';

describe('TestimonialsFeatured', () => {
  it('renders Sarah featured quote with attribution', () => {
    const content = enContent.testimonials.featured;
    const { container } = render(<TestimonialsFeatured content={content} />);

    const section = screen.getByRole('region', { name: content.sectionLabel });
    expect(section).toHaveAttribute('id', 'testimonials-featured');
    expect(section).toHaveAttribute('data-figma-node', 'testimonials-featured');
    expect(section).toHaveClass('es-testimonials-featured-section');

    expect(screen.getByTestId('testimonials-featured-card')).toBeInTheDocument();
    expect(screen.getByText(content.quote)).toBeInTheDocument();
    expect(screen.getByText(content.author)).toBeInTheDocument();
    expect(screen.getByText(content.service)).toBeInTheDocument();
    expect(container.querySelector('.es-testimonial-quote-icon')).not.toBeNull();
  });

  it('renders locale featured copy', () => {
    const content = zhCNContent.testimonials.featured;
    render(<TestimonialsFeatured content={content} />);

    expect(screen.getByRole('region', { name: content.sectionLabel })).toBeInTheDocument();
    expect(screen.getByText(content.quote)).toBeInTheDocument();
    expect(screen.getByText(content.author)).toBeInTheDocument();
  });
});

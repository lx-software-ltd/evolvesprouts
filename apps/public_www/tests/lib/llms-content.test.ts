import { describe, expect, it } from 'vitest';

import enContent from '@/content/en.json';
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/llms-content';

const TEST_CONTACT_EMAIL = process.env.NEXT_PUBLIC_EMAIL ?? 'tests@example.com';
const FOUNDER_NAME = enContent.aboutUs.coaches.ida.title;
process.env.NEXT_PUBLIC_FOUNDER_NAME = FOUNDER_NAME;

describe('buildLlmsTxt', () => {
  const output = buildLlmsTxt(enContent);

  it('starts with the brand name as an H1 heading', () => {
    expect(output).toMatch(/^# Evolve Sprouts\n/);
  });

  it('includes the organization description from content', () => {
    expect(output).toContain(enContent.seo.organizationDescription);
  });

  it('includes links to all key pages', () => {
    expect(output).toContain('[Home]');
    expect(output).toContain('[About Us]');
    expect(output).toContain('[Events]');
    expect(output).toContain('[Contact Us]');
    expect(output).toContain(`[${enContent.seo.trainingCourse.title}]`);
  });

  it('includes page descriptions from content', () => {
    expect(output).toContain(enContent.seo.home.description);
    expect(output).toContain(enContent.seo.trainingCourse.description);
    expect(output).toContain(enContent.events.description);
  });

  it('includes the contact email from config', () => {
    expect(output).toContain(TEST_CONTACT_EMAIL);
  });

  it('includes the founder name from NEXT_PUBLIC_FOUNDER_NAME', () => {
    expect(output).toContain(`**Founded by**: ${FOUNDER_NAME}, Montessori-certified practitioner`);
  });

  it('includes the required llms.txt sections', () => {
    expect(output).toContain('## What We Do');
    expect(output).toContain('## Key Information');
    expect(output).toContain('## Services');
    expect(output).toContain('## What We Do Not Do');
    expect(output).toContain('## Contact');
    expect(output).toContain('## Optional');
  });

  it('includes course inclusion titles from content', () => {
    for (const item of enContent.myBestAuntie.description.items) {
      expect(output.toLowerCase()).toContain(item.title.toLowerCase());
    }
  });

  it('includes a link to llms-full.txt', () => {
    expect(output).toContain('/llms-full.txt');
  });

  it('reflects content changes in area served', () => {
    expect(output).toContain(enContent.seo.localBusinessAreaServed);
  });

  it('includes privacy and terms descriptions from content', () => {
    expect(output).toContain(enContent.privacyPolicy.description);
    expect(output).toContain(enContent.termsAndConditions.description);
  });
});

describe('buildLlmsFullTxt', () => {
  const output = buildLlmsFullTxt(enContent);

  it('starts with the brand name in the heading', () => {
    expect(output).toMatch(/^# Evolve Sprouts/);
  });

  it('includes the founder description from content', () => {
    expect(output).toContain(`### The Founder: ${FOUNDER_NAME}`);
    expect(output).toContain(enContent.aboutUs.hero.subtitle);
    expect(output).toContain(enContent.aboutUs.hero.description);
  });

  it('includes the mission from content', () => {
    expect(output).toContain(enContent.aboutUs.whyUs.title);
    expect(output).toContain(enContent.aboutUs.whyUs.description);
  });

  it('includes all core pillars from content', () => {
    for (const pillar of enContent.aboutUs.whyUs.pillars) {
      expect(output).toContain(pillar.title);
      expect(output).toContain(pillar.description);
    }
  });

  it('includes course module details from content', () => {
    for (const mod of enContent.myBestAuntie.outline.modules) {
      expect(output).toContain(mod.title);
      expect(output).toContain(mod.activity);
    }
  });

  it('includes all course inclusion items from content', () => {
    for (const item of enContent.myBestAuntie.description.items) {
      expect(output).toContain(item.title);
      expect(output).toContain(item.description);
    }
  });

  it('includes all services items from content', () => {
    for (const item of enContent.services.items) {
      expect(output).toContain(item.title);
      expect(output).toContain(item.description);
    }
  });

  it('includes all FAQ questions and answers from content', () => {
    for (const q of enContent.faq.questions) {
      expect(output).toContain(q.question);
      expect(output).toContain(q.answer);
    }
  });

  it('includes FAQ category labels from content', () => {
    for (const label of enContent.faq.labels) {
      expect(output).toContain(label.label);
    }
  });

  it('includes testimonial quotes from content', () => {
    const firstTestimonial = enContent.testimonials.items[0];
    expect(output).toContain(firstTestimonial.author);
  });

  it('includes the contact email from config', () => {
    expect(output).toContain(TEST_CONTACT_EMAIL);
  });

  it('includes multilingual site URLs', () => {
    expect(output).toContain('/en/');
    expect(output).toContain('/zh-CN/');
    expect(output).toContain('/zh-HK/');
  });

  it('includes site page links for all indexed routes', () => {
    expect(output).toContain('[Home]');
    expect(output).toContain('[About Us]');
    expect(output).toContain('[Events]');
    expect(output).toContain('[Contact Us]');
    expect(output).toContain('[Privacy Policy]');
    expect(output).toContain('[Terms and Conditions]');
    expect(output).toContain('[My Best Auntie');
  });

  it('includes the my history description from content', () => {
    expect(output).toContain(enContent.aboutUs.myHistory.description);
  });
});

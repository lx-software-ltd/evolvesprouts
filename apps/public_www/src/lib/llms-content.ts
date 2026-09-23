import type { SiteContent } from '@/content';
import { resolvePolicyDescription } from '@/content/copy-normalizers';
import { INDEXED_ROUTE_PATHS, ROUTES } from '@/lib/routes';
import { getLandingPageContent } from '@/lib/landing-pages';
import { getSiteOrigin, localizePath } from '@/lib/seo';
import { resolvePublicSiteConfig } from '@/lib/site-config';

function siteUrl(path: string): string {
  return `${getSiteOrigin()}${localizePath(path, 'en')}`;
}

function lines(...parts: string[]): string {
  return parts.join('\n');
}

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function linkedBullet(label: string, path: string, description: string): string {
  return `- [${label}](${siteUrl(path)}): ${description}`;
}

interface PageDescriptor {
  label: string;
  path: string;
  description: string;
}

function resolvePageDescriptors(content: SiteContent): PageDescriptor[] {
  return [
    {
      label: 'Home',
      path: ROUTES.home,
      description: content.seo.home.description,
    },
    {
      label: content.seo.trainingCourse.title,
      path: ROUTES.servicesMyBestAuntieTrainingCourse,
      description: content.seo.trainingCourse.description,
    },
    {
      label: 'About Us',
      path: ROUTES.about,
      description: content.aboutUs.hero.subtitle,
    },
    {
      label: 'Events',
      path: ROUTES.events,
      description: content.events.description,
    },
    {
      label: 'Contact Us',
      path: ROUTES.contact,
      description: content.contactUs.form.description,
    },
    ...(() => {
      const bookFreeCall = getLandingPageContent('book-a-free-call', 'en');
      if (!bookFreeCall) {
        return [];
      }
      return [{
        label: bookFreeCall.meta.title.split('|')[0]?.trim() || bookFreeCall.meta.title,
        path: ROUTES.bookFreeCall,
        description: bookFreeCall.meta.description,
      }];
    })(),
  ];
}

function buildPageLinksSection(pages: PageDescriptor[]): string {
  return pages
    .map((page) => linkedBullet(page.label, page.path, page.description))
    .join('\n');
}

function buildFaqSummaryLink(content: SiteContent): string {
  return linkedBullet(
    'FAQ',
    `${ROUTES.about}#faq`,
    `Frequently asked questions about services, pricing, Montessori approach, helper training, and suitability for Hong Kong families.`,
  );
}

function founderDisplayName(): string {
  return resolvePublicSiteConfig().founderName ?? '';
}

function buildKeyInformation(content: SiteContent): string {
  const founderName = founderDisplayName();
  const foundedBy = founderName
    ? `**Founded by**: ${founderName}, Montessori-certified practitioner`
    : '**Founded by**: a Montessori-certified practitioner';
  const items = [
    `**Location**: Hong Kong`,
    `**Area served**: ${content.seo.localBusinessAreaServed}`,
    `**Languages**: English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文)`,
    foundedBy,
    `**Target audience**: Families with children aged 0-6 in Hong Kong, especially those working with domestic helpers`,
  ];
  return bulletList(items);
}

function buildServicesSection(content: SiteContent): string {
  const courseItems = content.myBestAuntie.description.items;
  const courseInclusions = courseItems
    .map((item) => item.title.toLowerCase())
    .join(', ');

  const items = [
    `**${content.seo.trainingCourse.title}**: ${content.seo.trainingCourse.description} Includes ${courseInclusions}.`,
    `**Consultation sessions**: Personalised family support and guidance.`,
    `**Home setup guidance**: Practical Montessori-adapted space setup for small Hong Kong apartments.`,
    `**Parent support**: Ongoing coaching and resources for families.`,
    `**Free resources**: ${content.resources.description}`,
    `**Community newsletter**: ${content.footer.communityHeading}`,
  ];
  return bulletList(items);
}

function buildNotDoSection(): string {
  const items = [
    'Evolve Sprouts does not provide childcare or nanny placement services.',
    'Evolve Sprouts does not offer online-only training courses (training is in-person in Hong Kong).',
    'Evolve Sprouts is not a Montessori school or daycare facility.',
    'Evolve Sprouts does not guarantee specific child behavior outcomes.',
  ];
  return bulletList(items);
}

function buildContactSection(content: SiteContent): string {
  const { contactEmail } = resolvePublicSiteConfig();
  const siteOrigin = getSiteOrigin();
  const items = [
    `**Email**: ${contactEmail}`,
    `**WhatsApp**: Available via website contact button`,
    `**Website**: ${siteOrigin}`,
    `**Response time**: 24-48 hours`,
  ];
  return bulletList(items);
}

export function buildLlmsTxt(content: SiteContent): string {
  const brand = content.navbar.brand;
  const orgDescription = content.seo.organizationDescription;
  const pages = resolvePageDescriptors(content);
  const siteOrigin = getSiteOrigin();

  const privacyDescription = resolvePolicyDescription(content.privacyPolicy);
  const termsDescription = resolvePolicyDescription(content.termsAndConditions);

  return lines(
    `# ${brand}`,
    '',
    `> ${orgDescription}`,
    '',
    '## What We Do',
    '',
    buildPageLinksSection(pages),
    buildFaqSummaryLink(content),
    '',
    '## Key Information',
    '',
    buildKeyInformation(content),
    '',
    '## Services',
    '',
    buildServicesSection(content),
    '',
    '## What We Do Not Do',
    '',
    buildNotDoSection(),
    '',
    '## Contact',
    '',
    buildContactSection(content),
    '',
    '## Optional',
    '',
    linkedBullet('Privacy Policy', ROUTES.privacy, privacyDescription),
    linkedBullet('Terms and Conditions', ROUTES.terms, termsDescription),
    `- [Extended AI context](${siteOrigin}/llms-full.txt): Comprehensive content including full FAQ, course details, and testimonials for deeper AI understanding.`,
    '',
  );
}

function buildFounderSection(content: SiteContent): string {
  const founderName = founderDisplayName();
  const heading = founderName ? `### The Founder: ${founderName}` : '### The Founder';
  return lines(
    heading,
    '',
    content.aboutUs.hero.subtitle,
    content.aboutUs.hero.description,
    '',
    content.aboutUs.myHistory.description,
  );
}

function buildPillarsSection(content: SiteContent): string {
  return content.aboutUs.whyUs.pillars
    .map((pillar, index) => `${index + 1}. **${pillar.title}**: ${pillar.description}`)
    .join('\n');
}

function buildCourseModulesSection(content: SiteContent): string {
  return content.myBestAuntie.outline.modules
    .map(
      (mod) =>
        `- **${mod.week} (${mod.title})**: ${mod.activity}`,
    )
    .join('\n');
}

function buildCourseInclusionsSection(content: SiteContent): string {
  return content.myBestAuntie.description.items
    .map((item) => `- **${item.title}**: ${item.description}`)
    .join('\n');
}

function buildServicesHighlightsSection(content: SiteContent): string {
  return content.services.items
    .map((item) => `- **${item.title}**: ${item.description}`)
    .join('\n');
}

function buildFullFaqSection(content: SiteContent): string {
  const groupedByLabel = new Map<string, typeof content.faq.questions>();

  for (const label of content.faq.labels) {
    groupedByLabel.set(label.id, []);
  }

  for (const question of content.faq.questions) {
    const primaryLabelId = question.labelIds[0];
    if (primaryLabelId && groupedByLabel.has(primaryLabelId)) {
      groupedByLabel.get(primaryLabelId)!.push(question);
    }
  }

  const sections: string[] = [];
  for (const label of content.faq.labels) {
    const questions = groupedByLabel.get(label.id);
    if (!questions || questions.length === 0) continue;

    sections.push(`### ${label.label}`);
    sections.push('');
    for (const q of questions) {
      sections.push(`**Q: ${q.question}**`);
      sections.push(`A: ${q.answer}`);
      sections.push('');
    }
  }

  return sections.join('\n');
}

function buildTestimonialsSection(content: SiteContent): string {
  return content.testimonials.items
    .filter((t) => t.quote.length > 0)
    .slice(0, 8)
    .map(
      (t) =>
        `- "${t.quote.length > 300 ? `${t.quote.slice(0, 297)}...` : t.quote}" - ${t.author}, ${t.role}`,
    )
    .join('\n\n');
}

function buildSitePagesSection(): string {
  const bookFreeCall = getLandingPageContent('book-a-free-call', 'en');
  const pageLabels: Record<string, string> = {
    '/': 'Home',
    '/about-us': 'About Us',
    '/events': 'Events',
    '/contact-us': 'Contact Us',
    '/privacy': 'Privacy Policy',
    '/terms': 'Terms and Conditions',
    '/services/my-best-auntie-training-course':
      'My Best Auntie - 9 Weeks That Change How Your Child Is Raised Every Day',
    ...(bookFreeCall
      ? {
          [ROUTES.bookFreeCall]: bookFreeCall.meta.title.split('|')[0]?.trim()
            || bookFreeCall.meta.title,
        }
      : {}),
  };

  return INDEXED_ROUTE_PATHS.map(
    (path) => `- [${pageLabels[path] ?? path}](${siteUrl(path)})`,
  ).join('\n');
}

function buildMultilingualSection(): string {
  const siteOrigin = getSiteOrigin();
  return lines(
    '### Multilingual Versions',
    '',
    'The site is available in three languages:',
    `- English: ${siteOrigin}/en/`,
    `- Simplified Chinese (简体中文): ${siteOrigin}/zh-CN/`,
    `- Traditional Chinese (繁體中文): ${siteOrigin}/zh-HK/`,
  );
}

export function buildLlmsFullTxt(content: SiteContent): string {
  const brand = content.navbar.brand;
  const orgDescription = content.seo.organizationDescription;
  const { contactEmail } = resolvePublicSiteConfig();
  const siteOrigin = getSiteOrigin();

  return lines(
    `# ${brand} - Full AI Context`,
    '',
    `> ${orgDescription}`,
    '',
    '---',
    '',
    `## About ${brand}`,
    '',
    buildFounderSection(content),
    '',
    '### Mission',
    '',
    content.aboutUs.whyUs.title,
    '',
    content.aboutUs.whyUs.description,
    '',
    '### Core Pillars',
    '',
    buildPillarsSection(content),
    '',
    '---',
    '',
    `## ${content.seo.trainingCourse.title}`,
    '',
    '### Outline',
    '',
    `${content.myBestAuntie.outline.description} ${content.seo.trainingCourse.description}`,
    '',
    '### Course Structure',
    '',
    buildCourseModulesSection(content),
    '',
    '### What Is Included',
    '',
    buildCourseInclusionsSection(content),
    '',
    '### Services Highlights: Why Families Choose This Course',
    '',
    buildServicesHighlightsSection(content),
    '',
    '---',
    '',
    '## Other Services',
    '',
    buildServicesSection(content),
    '',
    '---',
    '',
    '## Frequently Asked Questions',
    '',
    buildFullFaqSection(content),
    '---',
    '',
    '## Testimonials',
    '',
    buildTestimonialsSection(content),
    '',
    '---',
    '',
    '## Contact Information',
    '',
    bulletList([
      `**Email**: ${contactEmail}`,
      `**WhatsApp**: Available via website contact button`,
      `**Website**: ${siteOrigin}`,
      `**Response time**: 24-48 hours`,
    ]),
    '',
    '---',
    '',
    '## What Evolve Sprouts Does Not Do',
    '',
    buildNotDoSection(),
    '',
    '---',
    '',
    '## Site Pages',
    '',
    buildSitePagesSection(),
    '',
    buildMultilingualSection(),
    '',
  );
}

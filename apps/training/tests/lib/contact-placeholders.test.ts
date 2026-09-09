import { describe, expect, it } from 'vitest';

import { applyFormContactPlaceholders } from '@/lib/apply-form-contact-placeholders';
import { applyContactPlaceholderTemplate } from '@/lib/contact-placeholders';
import type { FormContent } from '@/content/form-types';
import {
  parseTrainingFormSlugFromPath,
  trainingFormRequiresContact,
} from '@/lib/training-form-catalog';

describe('contact placeholders', () => {
  it('replaces known tokens and leaves unknown tokens', () => {
    expect(
      applyContactPlaceholderTemplate('Hi {contactFirstName}, see {children.firstName}', {
        contactFirstName: 'Jane',
        'children.firstName': 'Mia and Leo',
      }),
    ).toBe('Hi Jane, see Mia and Leo');
    expect(applyContactPlaceholderTemplate('Question {current} of {total}', {})).toBe(
      'Question {current} of {total}',
    );
  });

  it('uses English fallbacks when values are missing', () => {
    const form: FormContent = {
      title: 'Hello {contactName}',
      slug: 'demo',
      requiresContact: true,
      questions: [
        {
          id: 'q1',
          type: 'text',
          question: 'How is {helpers.firstName}?',
          hint: 'Family: {familyName}',
        },
      ],
    };
    const personalized = applyFormContactPlaceholders(form, null);
    expect(personalized.title).toBe('Hello there');
    expect(personalized.questions[0].question).toBe('How is your helper?');
    expect(personalized.questions[0].hint).toBe('Family: your family');
  });
});

describe('training form catalog', () => {
  it('treats current workshop forms as not requiring a contact', () => {
    expect(trainingFormRequiresContact('workshop-feedback')).toBe(false);
    expect(trainingFormRequiresContact('workshop-exit-feedback')).toBe(false);
    expect(trainingFormRequiresContact('missing')).toBe(false);
  });

  it('parses a form slug from a training path', () => {
    expect(parseTrainingFormSlugFromPath('/forms/workshop-feedback/')).toBe('workshop-feedback');
    expect(parseTrainingFormSlugFromPath('/forms/workshop-feedback')).toBe('workshop-feedback');
    expect(parseTrainingFormSlugFromPath('/polls/workshop-food-jun-26/')).toBeNull();
    expect(parseTrainingFormSlugFromPath('/')).toBeNull();
  });
});

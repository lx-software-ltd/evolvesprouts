import { describe, expect, it } from 'vitest';

import type { FormContent } from '@/content/form-types';
import { applyFormContactPlaceholders } from '@/lib/apply-form-contact-placeholders';
import { applyContactPlaceholderTemplate } from '@/lib/contact-placeholders';
import { getFormContent } from '@/lib/forms';
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

  it('requires a contact for the pre-session check-in form', () => {
    expect(trainingFormRequiresContact('pre-session-check-in')).toBe(true);
  });

  it('fills pre-session check-in copy with English fallbacks', () => {
    const form = getFormContent('pre-session-check-in');
    expect(form).toBeTruthy();
    const personalized = applyFormContactPlaceholders(form as FormContent, null);
    expect(personalized.title).toBe('Ciao there 🌿');
    expect(personalized.questions[0]?.question).toBe(
      'What does a normal day look like for your child?',
    );
    expect(personalized.questions[5]?.question).toBe(
      'your helper — how long with you, what languages, and open to trying new things?',
    );
  });

  it('fills pre-session check-in copy from contact placeholders', () => {
    const form = getFormContent('pre-session-check-in');
    expect(form).toBeTruthy();
    const personalized = applyFormContactPlaceholders(form as FormContent, {
      contactFirstName: 'Jane',
      'children.firstName': 'Mia',
      'helpers.firstName': 'Ana',
    });
    expect(personalized.title).toBe('Ciao Jane 🌿');
    expect(personalized.questions[0]?.question).toBe(
      'What does a normal day look like for Mia?',
    );
    expect(personalized.questions[1]?.question).toBe(
      "Who's with Mia most of the day, and what does a usual stretch with Ana look like?",
    );
    expect(personalized.questions[5]?.question).toBe(
      'Ana — how long with you, what languages, and open to trying new things?',
    );
  });

  it('parses a form slug from a training path', () => {
    expect(parseTrainingFormSlugFromPath('/forms/workshop-feedback/')).toBe('workshop-feedback');
    expect(parseTrainingFormSlugFromPath('/forms/workshop-feedback')).toBe('workshop-feedback');
    expect(parseTrainingFormSlugFromPath('/forms/pre-session-check-in/')).toBe(
      'pre-session-check-in',
    );
    expect(parseTrainingFormSlugFromPath('/polls/workshop-food-jun-26/')).toBeNull();
    expect(parseTrainingFormSlugFromPath('/')).toBeNull();
  });
});

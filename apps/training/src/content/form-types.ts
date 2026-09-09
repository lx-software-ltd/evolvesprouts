import formsCommonJson from '@/content/forms-common.json';
import preSessionCheckInJson from '@/content/forms/pre-session-check-in.json';
import workshopExitFeedbackJson from '@/content/forms/workshop-exit-feedback.json';
import workshopFeedbackJson from '@/content/forms/workshop-feedback.json';

export interface FormQuestionBase {
  id: string;
  /** Eyebrow label shown above the question. */
  screen?: string;
  question: string;
  hint?: string;
  /** When false, the question may be skipped. Defaults to true. */
  required?: boolean;
}

export interface FormSelectQuestion extends FormQuestionBase {
  type: 'select';
  options: string[];
}

export interface FormMultiselectQuestion extends FormQuestionBase {
  type: 'multiselect';
  options: string[];
  /** Maximum number of options the respondent may select. */
  maxSelections: number;
}

export interface FormRatingOption {
  value: number;
  emoji: string;
  /** Accessible label when the emoji alone is insufficient. */
  ariaLabel?: string;
}

export interface FormRatingQuestion extends FormQuestionBase {
  type: 'rating';
  options: FormRatingOption[];
}

export interface FormSegmentedOption {
  value: string;
  label: string;
}

export interface FormSegmentedQuestion extends FormQuestionBase {
  type: 'segmented';
  options: FormSegmentedOption[];
}

export interface FormConsentQuestion extends FormQuestionBase {
  type: 'consent';
  consentText: string;
  followUp?: {
    placeholder: string;
    required?: boolean;
  };
}

export interface FormTextQuestion extends FormQuestionBase {
  type: 'text';
  placeholder?: string;
}

export interface FormEmailQuestion extends FormQuestionBase {
  type: 'email';
  placeholder?: string;
}

export type FormQuestion =
  | FormSelectQuestion
  | FormMultiselectQuestion
  | FormRatingQuestion
  | FormSegmentedQuestion
  | FormConsentQuestion
  | FormTextQuestion
  | FormEmailQuestion;

export interface FormContent {
  title: string;
  slug: string;
  /** When true, admin Copy link / QR require a CRM contact and the page fills `{contactName}` tokens. */
  requiresContact?: boolean;
  questions: FormQuestion[];
  completion?: {
    description?: string;
  };
}

export interface FormsCommonContent {
  navigation: {
    back: string;
    next: string;
    finish: string;
  };
  completion: {
    title: string;
    description: string;
  };
  multiselect: {
    pickUpToTemplate: string;
  };
  errors: {
    required: string;
    invalidEmail: string;
    persistFailed: string;
    missingApiConfig: string;
    maxSelectionsTemplate: string;
  };
  a11y: {
    progressTemplate: string;
  };
}

export const FORMS_COMMON = formsCommonJson as FormsCommonContent;

const workshopFeedback = workshopFeedbackJson as FormContent;
const workshopExitFeedback = workshopExitFeedbackJson as FormContent;
const preSessionCheckIn = preSessionCheckInJson as FormContent;

const FORMS = {
  'workshop-feedback': workshopFeedback,
  'workshop-exit-feedback': workshopExitFeedback,
  'pre-session-check-in': preSessionCheckIn,
} satisfies Record<string, FormContent>;

export type FormSlug = keyof typeof FORMS;

const FORM_SLUGS = Object.freeze(Object.keys(FORMS) as FormSlug[]);

export function getAllFormSlugs(): FormSlug[] {
  return [...FORM_SLUGS];
}

export function isValidFormSlug(slug: string): slug is FormSlug {
  return slug in FORMS;
}

export function getFormContent(slug: string): FormContent | null {
  if (!isValidFormSlug(slug)) {
    return null;
  }
  return FORMS[slug];
}

export function buildFormPath(slug: FormSlug | string): string {
  return `/forms/${slug}/`;
}

export function isQuestionRequired(question: FormQuestion): boolean {
  return question.required !== false;
}

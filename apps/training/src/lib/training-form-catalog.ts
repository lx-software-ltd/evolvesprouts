/**
 * Training-form contact personalization flags, derived from form JSON.
 * Admin Website Forms / QR import this module via `@shared-training/*`
 * so `requiresContact` stays aligned with `apps/training` content.
 */
import workshopExitFeedbackJson from '../content/forms/workshop-exit-feedback.json';
import workshopFeedbackJson from '../content/forms/workshop-feedback.json';

interface FormContactFlag {
  slug: string;
  requiresContact?: boolean;
}

const FORM_CONTACT_FLAGS: readonly FormContactFlag[] = [
  workshopFeedbackJson as FormContactFlag,
  workshopExitFeedbackJson as FormContactFlag,
];

const FORM_SLUG_PATH = /^\/forms\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function trainingFormRequiresContact(slug: string): boolean {
  const row = FORM_CONTACT_FLAGS.find((item) => item.slug === slug);
  return row?.requiresContact === true;
}

export function parseTrainingFormSlugFromPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) {
    return null;
  }
  const withoutQuery = trimmed.split('?')[0]?.split('#')[0] ?? '';
  const normalized = withoutQuery.replace(/\/+$/, '') || '/';
  const match = FORM_SLUG_PATH.exec(normalized);
  return match?.[1] ?? null;
}

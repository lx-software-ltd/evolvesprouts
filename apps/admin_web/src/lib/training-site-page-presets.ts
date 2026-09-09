import { TRAINING_ROUTES } from '@shared-training/training-routes';

/**
 * Curated training-site paths for QR presets (same paths as `TRAINING_ROUTES` in
 * `apps/training/src/lib/training-routes.ts`).
 */
export interface TrainingSitePagePreset {
  label: string;
  /** Raw path input accepted by `normalizePublicSitePathInput` (with or without trailing slash). */
  pathInput: string;
}

const PRESET_ROWS: readonly { label: string; routeKey: keyof typeof TRAINING_ROUTES }[] = [
  { label: 'Home', routeKey: 'home' },
  { label: 'Workshop feedback form', routeKey: 'formsWorkshopFeedback' },
  { label: 'Workshop exit feedback', routeKey: 'formsWorkshopExitFeedback' },
  { label: 'Pre-session check-in', routeKey: 'formsPreSessionCheckIn' },
  { label: 'Workshop food poll (Jun 26)', routeKey: 'pollsWorkshopFoodJun26' },
] as const;

export const TRAINING_SITE_PAGE_PRESETS: readonly TrainingSitePagePreset[] = PRESET_ROWS.map(
  ({ label, routeKey }) => ({
    label,
    pathInput: TRAINING_ROUTES[routeKey],
  }),
);

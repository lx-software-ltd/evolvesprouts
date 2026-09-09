/**
 * Canonical first-party path strings for the training website.
 * Single source of truth for admin Website QR presets (`apps/admin_web`).
 */
export const TRAINING_ROUTES = {
  home: '/',
  formsWorkshopFeedback: '/forms/workshop-feedback',
  formsWorkshopExitFeedback: '/forms/workshop-exit-feedback',
  formsPreSessionCheckIn: '/forms/pre-session-check-in',
  pollsWorkshopFoodJun26: '/polls/workshop-food-jun-26',
} as const;

export type TrainingAppRoutePath = (typeof TRAINING_ROUTES)[keyof typeof TRAINING_ROUTES];

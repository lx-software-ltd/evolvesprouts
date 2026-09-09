'use client';

import { trainingFormRequiresContact } from '@shared-training/training-form-catalog';

import { WebsiteAnswersPanel } from '@/components/admin/website/website-answers-panel';
import {
  clearAdminFormAnswers,
  exportAdminFormAnswersCsv,
  formatFormAnswerValue,
  listAdminFormAnswers,
  listAdminForms,
  type AdminFormAnswerRow,
} from '@/lib/forms-api';

export function WebsiteFormsPanel() {
  return (
    <WebsiteAnswersPanel<AdminFormAnswerRow>
      noun='form'
      listSummaries={async (signal) => {
        const items = await listAdminForms(signal);
        return items.map((item) => ({
          slug: item.formSlug,
          answerCount: item.answerCount,
          requiresContact: trainingFormRequiresContact(item.formSlug),
        }));
      }}
      listAnswers={listAdminFormAnswers}
      exportCsv={exportAdminFormAnswersCsv}
      clearAnswers={async (slug) => {
        await clearAdminFormAnswers(slug);
      }}
      formatAnswer={formatFormAnswerValue}
    />
  );
}

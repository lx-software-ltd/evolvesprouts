'use client';

import { WebsiteAnswersPanel } from '@/components/admin/website/website-answers-panel';
import {
  clearAdminPollAnswers,
  exportAdminPollAnswersCsv,
  formatPollAnswerValue,
  listAdminPollAnswers,
  listAdminPolls,
  type AdminPollAnswerRow,
} from '@/lib/polls-api';

export function WebsitePollsPanel() {
  return (
    <WebsiteAnswersPanel<AdminPollAnswerRow>
      noun='poll'
      listSummaries={async (signal) => {
        const items = await listAdminPolls(signal);
        return items.map((item) => ({ slug: item.pollSlug, answerCount: item.answerCount }));
      }}
      listAnswers={listAdminPollAnswers}
      exportCsv={exportAdminPollAnswersCsv}
      clearAnswers={async (slug) => {
        await clearAdminPollAnswers(slug);
      }}
      formatAnswer={formatPollAnswerValue}
    />
  );
}

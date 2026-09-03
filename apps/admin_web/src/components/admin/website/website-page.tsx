'use client';

import { WebsiteFormsPanel } from '@/components/admin/website/website-forms-panel';
import { WebsitePollsPanel } from '@/components/admin/website/website-polls-panel';
import { WebsiteQrPage } from '@/components/admin/website/website-qr-page';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { useQueryTabState } from '@/hooks/use-query-tab-state';

const TAB_ITEMS = [
  { key: 'qr-codes', label: 'QR Codes' },
  { key: 'forms', label: 'Forms' },
  { key: 'polls', label: 'Polls' },
] as const;

type WebsiteView = (typeof TAB_ITEMS)[number]['key'];

const WEBSITE_TAB_KEYS: readonly WebsiteView[] = TAB_ITEMS.map((item) => item.key);
const DEFAULT_WEBSITE_VIEW: WebsiteView = 'qr-codes';

export function WebsitePage() {
  const [activeView, setActiveView] = useQueryTabState<WebsiteView>(
    WEBSITE_TAB_KEYS,
    DEFAULT_WEBSITE_VIEW
  );

  return (
    <div className='space-y-4'>
      <AdminTabStrip
        items={TAB_ITEMS}
        activeKey={activeView}
        onChange={setActiveView}
        aria-label='Website section views'
      />
      {activeView === 'qr-codes' ? <WebsiteQrPage /> : null}
      {activeView === 'forms' ? <WebsiteFormsPanel /> : null}
      {activeView === 'polls' ? <WebsitePollsPanel /> : null}
    </div>
  );
}

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebsitePage } from '@/components/admin/website/website-page';

vi.mock('@/lib/config', () => ({
  getPublicSiteBaseUrl: () => 'https://www.example.com',
  getTrainingSiteBaseUrl: () => 'https://training.example.com',
}));

vi.mock('@/lib/qr-code-image', () => ({
  generatePublicSiteQrPngDataUrl: vi.fn(async () => 'data:image/png;base64,AA'),
}));

vi.mock('@/components/admin/website/website-forms-panel', () => ({
  WebsiteFormsPanel: () => <div>Forms panel</div>,
}));

vi.mock('@/components/admin/website/website-polls-panel', () => ({
  WebsitePollsPanel: () => <div>Polls panel</div>,
}));

describe('WebsitePage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/website');
  });

  it('shows QR Codes tab by default', () => {
    render(<WebsitePage />);
    expect(screen.getByRole('group', { name: 'Website section views' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QR Codes', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Website QR codes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('switches to Forms tab', () => {
    render(<WebsitePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Forms' }));
    expect(screen.getByText('Forms panel')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Website QR codes' })).not.toBeInTheDocument();
  });

  it('switches to Polls tab', () => {
    render(<WebsitePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Polls' }));
    expect(screen.getByText('Polls panel')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Website QR codes' })).not.toBeInTheDocument();
  });
});

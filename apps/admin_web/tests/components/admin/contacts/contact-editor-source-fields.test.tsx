import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ContactEditorSourceFields } from '@/components/admin/contacts/contact-editor-source-fields';

function renderSourceFields(
  overrides: Partial<ComponentProps<typeof ContactEditorSourceFields>> = {}
) {
  const props: ComponentProps<typeof ContactEditorSourceFields> = {
    source: 'manual',
    sourceDetail: '',
    referralContactId: '',
    referralSearchInput: '',
    referralSelectOptions: [],
    onSourceChange: vi.fn(),
    onSourceDetailChange: vi.fn(),
    onReferralSearchInputChange: vi.fn(),
    onReferralContactIdChange: vi.fn(),
    ...overrides,
  };
  return render(<ContactEditorSourceFields {...props} />);
}

describe('ContactEditorSourceFields', () => {
  it('renders source detail as a single-line input on the same row as source', () => {
    renderSourceFields({ sourceDetail: 'Instagram story' });

    const source = screen.getByLabelText('Source');
    const sourceDetail = screen.getByLabelText('Source detail');

    expect(source.tagName).toBe('SELECT');
    expect(sourceDetail.tagName).toBe('INPUT');
    expect(sourceDetail).toHaveAttribute('type', 'text');
    expect(sourceDetail).toHaveValue('Instagram story');
    expect(source.parentElement?.parentElement).toBe(sourceDetail.parentElement?.parentElement);
  });

  it('keeps source and source detail on the same row when referral fields appear', () => {
    renderSourceFields({
      source: 'referral',
      sourceDetail: 'Friend intro',
    });

    const source = screen.getByLabelText('Source');
    const sourceDetail = screen.getByLabelText('Source detail');
    const referralSearch = screen.getByLabelText('Find referring contact');
    const referredBy = screen.getByLabelText('Referred by contact');

    expect(sourceDetail.tagName).toBe('INPUT');
    expect(source.parentElement?.parentElement).toBe(sourceDetail.parentElement?.parentElement);
    expect(source.parentElement?.parentElement).toBe(referralSearch.parentElement?.parentElement);
    expect(source.parentElement?.parentElement).toBe(referredBy.parentElement?.parentElement);
  });
});

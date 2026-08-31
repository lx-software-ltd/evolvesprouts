import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ConversationNameCell } from '@/components/admin/sales/conversation-name-cell';

describe('ConversationNameCell', () => {
  it('renders the CRM name as a contact link when a contact is linked', () => {
    render(
      <ConversationNameCell
        contactId='contact-1'
        contactName='Jane Doe'
        profileName='kitie.w'
      />
    );

    const link = screen.getByRole('link', { name: 'Jane Doe' });
    expect(link).toHaveAttribute('href', '/contacts?contact=contact-1');
  });

  it('renders the platform profile name without a link when no contact is linked', () => {
    render(
      <ConversationNameCell contactId={null} contactName={null} profileName='Kitie Wong' />
    );

    expect(screen.getByText('Kitie Wong')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('stops row click from firing when the contact link is used', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(
      <button type='button' onClick={onRowClick}>
        <ConversationNameCell
          contactId='contact-1'
          contactName='Jane Doe'
          profileName='kitie.w'
        />
      </button>
    );

    await user.click(screen.getByRole('link', { name: 'Jane Doe' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

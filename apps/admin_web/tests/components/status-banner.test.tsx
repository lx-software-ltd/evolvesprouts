import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StatusBanner } from '@/components/status-banner';

describe('StatusBanner', () => {
  it('renders title and message for each variant', () => {
    const { rerender } = render(
      <StatusBanner variant='info' title='Info title'>
        Informational content
      </StatusBanner>
    );

    expect(screen.getByText('Info title')).toBeInTheDocument();
    expect(screen.getByText('Informational content')).toBeInTheDocument();

    rerender(
      <StatusBanner variant='error' title='Error title'>
        Error content
      </StatusBanner>
    );
    expect(screen.getByText('Error title')).toBeInTheDocument();
    expect(screen.getByText('Error content')).toBeInTheDocument();

    rerender(
      <StatusBanner variant='success' title='Success title'>
        Success content
      </StatusBanner>
    );
    expect(screen.getByText('Success title')).toBeInTheDocument();
    expect(screen.getByText('Success content')).toBeInTheDocument();
  });

  it('supports rendering without a title', () => {
    render(<StatusBanner variant='info'>No title content</StatusBanner>);

    expect(screen.getByText('No title content')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onDismiss from the dismiss button', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <StatusBanner variant='success' title='Done' onDismiss={onDismiss}>
        Saved
      </StatusBanner>
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders children and stays interactive when not loading', () => {
    const onClick = vi.fn();
    render(
      <Button type='button' onClick={onClick}>
        Update contact
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Update contact' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button.querySelector('svg')).toBeNull();
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('swaps to a spinner plus "Saving…" and disables itself while loading', () => {
    const onClick = vi.fn();
    render(
      <Button type='button' onClick={onClick} loading>
        Update contact
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('data-loading', 'true');
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.queryByText('Update contact')).toBeNull();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepts an action-specific loading label', () => {
    render(
      <Button type='button' loading loadingLabel='Deleting…'>
        Delete
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  });
});

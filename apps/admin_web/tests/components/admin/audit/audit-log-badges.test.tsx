import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActionBadge, actionBadgeClassName } from '@/components/admin/audit/audit-log-badges';

describe('actionBadgeClassName', () => {
  it('uses INSERT green for draft-created actions', () => {
    const insertClass = actionBadgeClassName('INSERT');
    expect(actionBadgeClassName('DRAFT_CREATED')).toBe(insertClass);
    expect(actionBadgeClassName('DRAFT_CREATED_CUSTOMIZED')).toBe(insertClass);
    expect(insertClass).toContain('bg-green-100');
  });

  it('uses DELETE red for draft-delete and void actions', () => {
    const deleteClass = actionBadgeClassName('DELETE');
    expect(actionBadgeClassName('DELETE_DRAFT')).toBe(deleteClass);
    expect(actionBadgeClassName('VOID_FROM_DRAFT')).toBe(deleteClass);
    expect(actionBadgeClassName('VOID_FROM_ISSUED')).toBe(deleteClass);
    expect(deleteClass).toContain('bg-red-100');
  });
});

describe('ActionBadge', () => {
  it('renders the custom action label with INSERT colors', () => {
    render(<ActionBadge action='DRAFT_CREATED_CUSTOMIZED' />);
    const badge = screen.getByText('DRAFT_CREATED_CUSTOMIZED');
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
  });
});

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuditLogDetail } from '@/components/admin/audit/audit-log-detail';

import type { components } from '@/types/generated/admin-api.generated';

type AuditLog = components['schemas']['AuditLog'];

function buildLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: '00000000-0000-4000-8000-000000000007',
    table_name: 'contacts',
    record_id: 'c-77',
    action: 'UPDATE',
    timestamp: '2024-01-07T00:00:00.000Z',
    source: 'trigger',
    changed_fields: ['first_name'],
    old_values: { first_name: 'Ann', last_name: 'Lee' },
    new_values: { first_name: 'Anne', last_name: 'Lee' },
    ...overrides,
  };
}

describe('AuditLogDetail', () => {
  it('bolds changed field names and values in both old and new JSON', () => {
    render(<AuditLogDetail log={buildLog()} />);

    const oldJson = screen.getByLabelText('Old values JSON');
    const newJson = screen.getByLabelText('New values JSON');

    expect(within(oldJson).getByText('"first_name"').tagName).toBe('STRONG');
    expect(within(oldJson).getByText('Ann').tagName).toBe('STRONG');
    expect(within(oldJson).queryByText('"last_name"', { selector: 'strong' })).toBeNull();
    expect(oldJson).toHaveClass('bg-red-50');

    expect(within(newJson).getByText('"first_name"').tagName).toBe('STRONG');
    expect(within(newJson).getByText('Anne').tagName).toBe('STRONG');
    expect(within(newJson).queryByText('"last_name"', { selector: 'strong' })).toBeNull();
    expect(newJson).toHaveClass('bg-green-50');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SessionSlotEditor } from '@/components/admin/services/session-slot-editor';

describe('SessionSlotEditor', () => {
  it('renders column labels only on the first slot row', () => {
    render(
      <SessionSlotEditor
        slots={[
          {
            id: null,
            instanceId: null,
            locationId: null,
            startsAtLocal: null,
            endsAtLocal: null,
            sortOrder: 0,
          },
          {
            id: null,
            instanceId: null,
            locationId: null,
            startsAtLocal: null,
            endsAtLocal: null,
            sortOrder: 1,
          },
        ]}
        onChange={vi.fn()}
      />
    );

    const startLabels = screen.getAllByText('Start time');
    const endLabels = screen.getAllByText('End time');
    const locationLabels = screen.getAllByText('Location');
    const sortLabels = screen.getAllByText('Sort order');
    expect(startLabels).toHaveLength(1);
    expect(endLabels).toHaveLength(1);
    expect(locationLabels).toHaveLength(1);
    expect(sortLabels).toHaveLength(1);
  });

  it('sets end time two hours after start when start is entered', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SessionSlotEditor
        slots={[
          {
            id: null,
            instanceId: null,
            locationId: null,
            startsAtLocal: null,
            endsAtLocal: null,
            sortOrder: 0,
          },
        ]}
        onChange={onChange}
      />
    );

    const startInput = screen.getByLabelText('Start time');
    await user.type(startInput, '2026-04-24T10:00');

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0]?.[0];
    expect(last?.startsAtLocal).toBe('2026-04-24T10:00');
    expect(last?.endsAtLocal).toBe('2026-04-24T12:00');
  });

  it('prefills slot location from defaultLocationId when start is set and slot has no location', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const venueId = '11111111-1111-1111-1111-111111111111';
    render(
      <SessionSlotEditor
        defaultLocationId={venueId}
        slots={[
          {
            id: null,
            instanceId: null,
            locationId: null,
            startsAtLocal: null,
            endsAtLocal: null,
            sortOrder: 0,
          },
        ]}
        onChange={onChange}
      />
    );

    const startInput = screen.getByLabelText('Start time');
    await user.type(startInput, '2026-04-24T09:00');

    const last = onChange.mock.calls.at(-1)?.[0]?.[0];
    expect(last?.locationId).toBe(venueId);
    expect(last?.endsAtLocal).toBe('2026-04-24T11:00');
  });

  it('add slot uses defaultLocationId for new row location', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const venueId = '22222222-2222-2222-2222-222222222222';
    render(
      <SessionSlotEditor
        defaultLocationId={venueId}
        slots={[]}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('button', { name: /session slots/i }));
    await user.click(screen.getByRole('button', { name: /add slot/i }));

    expect(onChange).toHaveBeenCalledWith([
      {
        id: null,
        instanceId: null,
        locationId: venueId,
        startsAtLocal: null,
        endsAtLocal: null,
        sortOrder: 0,
      },
    ]);
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WebsiteAnswersPanel,
  type WebsiteAnswersRow,
} from '@/components/admin/website/website-answers-panel';

interface Row extends WebsiteAnswersRow {
  freeText: string;
}

const ROWS: Row[] = [
  {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    questionId: 'name',
    questionType: 'text',
    freeText: 'Alex',
    updatedAt: '2026-06-26T10:00:00Z',
  },
  {
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    questionId: 'feedback',
    questionType: 'textarea',
    freeText: 'Loved the workshop, especially the sensory play ideas.',
    updatedAt: '2026-06-26T10:05:00Z',
  },
];

function renderPanel(overrides: Partial<Parameters<typeof WebsiteAnswersPanel<Row>>[0]> = {}) {
  const props = {
    noun: 'form' as const,
    listSummaries: vi.fn().mockResolvedValue([
      { slug: 'workshop-feedback', answerCount: 2 },
      { slug: 'contact-us', answerCount: 0 },
    ]),
    listAnswers: vi.fn().mockResolvedValue({ items: ROWS, nextCursor: null }),
    exportCsv: vi.fn().mockResolvedValue(new Blob(['a,b'], { type: 'text/csv' })),
    clearAnswers: vi.fn().mockResolvedValue(undefined),
    formatAnswer: (row: Row) => row.freeText,
    ...overrides,
  };
  render(<WebsiteAnswersPanel<Row> {...props} />);
  return props;
}

describe('WebsiteAnswersPanel', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/website');
  });

  it('renders as a table-first block: picker filter, table tools in the trailing slot, no title', async () => {
    renderPanel();

    const region = await screen.findByRole('region', { name: 'Form answers' });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const filterBar = within(region).getByTestId('admin-filter-bar');
    expect(within(filterBar).getByLabelText('Form')).toBeInTheDocument();
    const trailing = within(filterBar).getByTestId('admin-filter-bar-trailing');
    expect(within(trailing).getByRole('button', { name: 'Export answers' })).toBeInTheDocument();
    expect(within(trailing).getByRole('button', { name: 'Clear answers' })).toBeInTheDocument();

    await waitFor(() => {
      expect(within(region).getByText('Alex')).toBeInTheDocument();
    });
    expect(within(filterBar).getByText('2 stored answer rows for workshop-feedback.')).toBeInTheDocument();
    // Read-only rows: no Operations column and no row action buttons.
    expect(within(region).queryByRole('columnheader', { name: 'Operations' })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('expands an answer row in place into a read-only detail panel', async () => {
    renderPanel();
    await screen.findByText('Alex');

    fireEvent.click(screen.getByRole('button', { name: /feedback answer from session/ }));

    const panel = await screen.findByTestId('admin-editor-panel');
    expect(within(panel).getByText('Session')).toBeInTheDocument();
    expect(within(panel).getByText('Loved the workshop, especially the sensory play ideas.')).toBeInTheDocument();
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('form-answer')).toBe(
      '550e8400-e29b-41d4-a716-446655440000:feedback'
    );
  });

  it('reloads answers immediately when another form is picked and collapses the open row', async () => {
    const props = renderPanel();
    await screen.findByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: /name answer from session/ }));
    await screen.findByTestId('admin-editor-panel');

    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'contact-us' } });

    await waitFor(() => {
      expect(props.listAnswers).toHaveBeenCalledWith('contact-us', expect.anything());
    });
    expect(screen.queryByTestId('admin-editor-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear answers' })).toBeDisabled();
  });

  it('confirms before clearing and then reloads summaries and answers', async () => {
    const props = renderPanel();
    await screen.findByText('Alex');

    fireEvent.click(screen.getByRole('button', { name: 'Clear answers' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Permanently delete all 2 stored answer rows for "workshop-feedback"/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear answers' }));

    await waitFor(() => {
      expect(props.clearAnswers).toHaveBeenCalledWith('workshop-feedback');
    });
    await waitFor(() => {
      expect(props.listSummaries).toHaveBeenCalledTimes(2);
    });
  });
});

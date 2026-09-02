import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminDataTableCell,
  AdminDataTableCellMeta,
  AdminDataTableHeadCell,
} from '@/components/ui/admin-data-table';
import { AdminCreateButton } from '@/components/ui/admin-create-button';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { AdminEditorActions, AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminExpandableRow } from '@/components/ui/admin-expandable-row';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminFilterBar, AdminFilterField } from '@/components/ui/admin-filter-bar';
import { AdminIconButton, AdminIconLink } from '@/components/ui/admin-icon-button';
import { AdminRecordTable } from '@/components/ui/admin-record-table';
import { AdminRowActions, type AdminRowAction } from '@/components/ui/admin-row-actions';
import { AdminSkeletonRows } from '@/components/ui/admin-skeleton';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';

function Icon({ name }: { name: string }) {
  return <svg data-icon={name} />;
}

describe('AdminFieldGrid / AdminField', () => {
  it('lays fields out in 1, 2, or 4 columns and lets a field span the row', () => {
    const { container, rerender } = render(
      <AdminFieldGrid columns={4}>
        <AdminField label='First' htmlFor='first' required>
          <input id='first' />
        </AdminField>
        <AdminField label='Notes' htmlFor='notes' span='full' hint='Optional'>
          <textarea id='notes' />
        </AdminField>
      </AdminFieldGrid>
    );
    const grid = container.firstElementChild;
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-2', 'xl:grid-cols-4');
    expect(screen.getByLabelText(/First/)).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes').parentElement).toHaveClass('col-span-full');

    rerender(
      <AdminFieldGrid columns={2}>
        <AdminField label='Email' htmlFor='email' error='Required' errorId='email-error'>
          <input id='email' aria-describedby='email-error' />
        </AdminField>
      </AdminFieldGrid>
    );
    expect(container.firstElementChild).toHaveClass('sm:grid-cols-2');
    expect(container.firstElementChild).not.toHaveClass('xl:grid-cols-4');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'email-error');
  });
});

describe('AdminEditorPanel / AdminEditorActions', () => {
  it('renders fields then a single left-aligned action row without any title', () => {
    render(
      <AdminEditorPanel actions={<AdminEditorActions mode='create' onSubmit={() => undefined} />}>
        <input aria-label='Name' />
      </AdminEditorPanel>
    );
    expect(screen.queryByRole('heading')).toBeNull();
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create.parentElement).toHaveClass('justify-start', 'gap-2');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('shows only Update in edit mode (no Cancel) and submits through the form id', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <AdminEditorPanel actions={<AdminEditorActions mode='edit' formId='editor-form' isSaving={false} />}>
        <form id='editor-form' onSubmit={onSubmit}>
          <input aria-label='Name' />
        </form>
      </AdminEditorPanel>
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Update']);
    expect(buttons[0]).toHaveAttribute('type', 'submit');
    expect(buttons[0]).toHaveAttribute('form', 'editor-form');
    fireEvent.click(buttons[0]);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables and relabels the primary action while saving', () => {
    render(
      <AdminEditorPanel actions={<AdminEditorActions mode='edit' isSaving />}>
        <p>body</p>
      </AdminEditorPanel>
    );
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('AdminDisclosure', () => {
  it('toggles an accessible region and keeps content mounted while collapsed', () => {
    render(
      <AdminDisclosure id='location' title='Location' summary='Hong Kong'>
        <input aria-label='Address' defaultValue='1 Main St' />
      </AdminDisclosure>
    );
    const trigger = screen.getByRole('button', { name: /Location/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById('location-panel');
    expect(region).not.toBeNull();
    expect(region?.querySelector('input')).toHaveValue('1 Main St');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', 'location-panel');
    expect(region?.parentElement).toHaveAttribute('data-open', 'true');
  });

  it('supports controlled open state', () => {
    const onOpenChange = vi.fn();
    render(
      <AdminDisclosure id='tags' title='Tags' open onOpenChange={onOpenChange}>
        <p>tag list</p>
      </AdminDisclosure>
    );
    const trigger = screen.getByRole('button', { name: /Tags/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('AdminFilterBar / AdminCreateButton', () => {
  it('renders labelled filters in one row with the create control trailing', () => {
    const onCreate = vi.fn();
    render(
      <AdminFilterBar
        summary='2 of 40'
        trailing={<AdminCreateButton label='New contact' onClick={onCreate} active />}
      >
        <AdminFilterField label='Search' htmlFor='search'>
          <input id='search' />
        </AdminFilterField>
      </AdminFilterBar>
    );
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByText('2 of 40')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'New contact' });
    expect(create).toHaveAttribute('title', 'New contact');
    expect(create).toHaveAttribute('aria-pressed', 'true');
    // Square and input-height on desktop; full-width with the label on phones.
    expect(create).toHaveClass('h-10', 'w-full', 'sm:h-9', 'sm:w-9', 'rounded-md', 'border');
    expect(create).toHaveTextContent('New contact');
    expect(create.querySelector('span')).toHaveClass('sm:hidden');
    expect(create.parentElement).toHaveClass('order-first', 'w-full', 'sm:order-none', 'sm:w-auto');
    fireEvent.click(create);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('AdminTabStrip', () => {
  it('renders a two-per-row grid on phones and a white bordered active control', () => {
    const onChange = vi.fn();
    render(
      <AdminTabStrip
        items={[
          { key: 'a', label: 'Contacts' },
          { key: 'b', label: 'Families' },
        ]}
        activeKey='a'
        onChange={onChange}
      />
    );
    const group = screen.getByRole('group', { name: 'Section views' });
    expect(group).toHaveClass('grid', 'grid-cols-2', 'sm:inline-flex');
    const active = screen.getByRole('button', { name: 'Contacts' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active).toHaveClass('bg-white', 'border', 'border-slate-300', 'w-full', 'sm:w-auto');
    const inactive = screen.getByRole('button', { name: 'Families' });
    expect(inactive).toHaveClass('border-transparent', 'hover:bg-white', 'hover:border-slate-300');
    fireEvent.click(inactive);
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('AdminDataTable column priority', () => {
  it('hides secondary and tertiary columns below md / lg and shows the mobile meta line', () => {
    render(
      <table>
        <thead>
          <tr>
            <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='secondary'>Email</AdminDataTableHeadCell>
            <AdminDataTableHeadCell priority='tertiary'>Type</AdminDataTableHeadCell>
          </tr>
        </thead>
        <tbody>
          <tr>
            <AdminDataTableCell>
              Ann
              <AdminDataTableCellMeta>ann@example.com</AdminDataTableCellMeta>
            </AdminDataTableCell>
            <AdminDataTableCell priority='secondary'>ann@example.com</AdminDataTableCell>
            <AdminDataTableCell priority='tertiary'>Parent</AdminDataTableCell>
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByRole('columnheader', { name: 'Email' })).toHaveClass('hidden', 'md:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Type' })).toHaveClass('hidden', 'lg:table-cell');
    expect(screen.getByRole('columnheader', { name: 'Name' })).not.toHaveClass('hidden');
    expect(screen.getAllByText('ann@example.com')[0]).toHaveClass('md:hidden');
  });
});

describe('AdminIconButton / AdminIconLink', () => {
  it('is icon-only with tooltip, border, fixed size, and white background', () => {
    render(<AdminIconButton label='Delete contact' tone='danger' icon={<Icon name='delete' />} badge={3} />);
    const button = screen.getByRole('button', { name: 'Delete contact' });
    expect(button).toHaveAttribute('title', 'Delete contact');
    expect(button).toHaveClass('h-8', 'w-8', 'border', 'border-slate-300', 'bg-white', 'text-red-600');
    expect(button.textContent).toBe('3');
    expect(button.querySelector('[data-icon="delete"]')).not.toBeNull();
  });

  it('renders a disabled link without navigating', () => {
    const onClick = vi.fn();
    render(<AdminIconLink href='/contacts?x=1' label='Open contact' icon={<Icon name='contact' />} disabled onClick={onClick} />);
    const link = screen.getByRole('link', { name: 'Open contact' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('tabindex', '-1');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('AdminRowActions', () => {
  function makeActions(count: number, overrides: Partial<AdminRowAction>[] = []): AdminRowAction[] {
    return Array.from({ length: count }, (_, index) => ({
      key: `a${index}`,
      label: `Action ${index}`,
      icon: <Icon name={`a${index}`} />,
      onClick: vi.fn(),
      ...overrides[index],
    }));
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders up to two actions inline as icon buttons', () => {
    render(<AdminRowActions actions={makeActions(2)} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Action 0' })).toHaveClass('h-8', 'w-8', 'bg-white');
  });

  it('keeps the first action inline and moves the rest behind a three-dots menu', () => {
    const actions = makeActions(4);
    render(<AdminRowActions actions={actions} />);
    expect(screen.getByRole('button', { name: 'Action 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Action 1' })).toBeNull();
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Action 1', 'Action 2', 'Action 3']);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]);
    expect(actions[2].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('closes the menu on Escape and on outside pointer down', () => {
    render(
      <div>
        <button type='button'>outside</button>
        <AdminRowActions actions={makeActions(3)} />
      </div>
    );
    const more = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('drops hidden actions before deciding whether to collapse', () => {
    render(<AdminRowActions actions={makeActions(3, [{}, { hidden: true }, {}])} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('does not bubble clicks to the row', () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <AdminRowActions actions={makeActions(1)} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Action 0' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('AdminExpandableRow', () => {
  function renderRow(expanded: boolean, onToggle = vi.fn(), actions?: React.ReactNode) {
    const utils = render(
      <table>
        <tbody>
          <AdminExpandableRow
            id='c1'
            label='Ada Lovelace'
            expanded={expanded}
            onToggle={onToggle}
            columnCount={actions ? 4 : 3}
            cells={
              <>
                <AdminDataTableCell>Ada</AdminDataTableCell>
                <AdminDataTableCell>Lovelace</AdminDataTableCell>
              </>
            }
            actions={actions}
            detail={<input aria-label='First name' defaultValue='Ada' />}
          />
        </tbody>
      </table>
    );
    return { ...utils, onToggle };
  }

  it('toggles from the row, the chevron, and the keyboard, but not from the Operations cell', () => {
    const { onToggle } = renderRow(false, vi.fn(), <button type='button'>op</button>);
    const row = screen.getByTestId('admin-row-c1');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('First name')).toBeNull();

    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Ada Lovelace' }));
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(4);

    fireEvent.click(screen.getByRole('button', { name: 'op' }));
    expect(onToggle).toHaveBeenCalledTimes(4);
  });

  it('mounts the detail while expanded and unmounts it after collapsing settles', () => {
    vi.useFakeTimers();
    const { rerender } = renderRow(true);
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByTestId('admin-row-c1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Collapse Ada Lovelace' })).toHaveAttribute(
      'aria-controls',
      'admin-row-c1-panel'
    );

    rerender(
      <table>
        <tbody>
          <AdminExpandableRow
            id='c1'
            label='Ada Lovelace'
            expanded={false}
            onToggle={() => undefined}
            columnCount={3}
            cells={<AdminDataTableCell>Ada</AdminDataTableCell>}
            detail={<input aria-label='First name' />}
          />
        </tbody>
      </table>
    );
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByLabelText('First name')).toBeNull();
    vi.useRealTimers();
  });

  it('moves focus into the first field once the expansion settles', () => {
    vi.useFakeTimers();
    renderRow(true);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(document.activeElement).toBe(screen.getByLabelText('First name'));
    vi.useRealTimers();
  });
});

describe('AdminRecordTable', () => {
  const head = (
    <tr>
      <AdminDataTableHeadCell />
      <AdminDataTableHeadCell>Name</AdminDataTableHeadCell>
    </tr>
  );

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('shows skeleton rows during the first load and an empty state afterwards', () => {
    const { rerender } = render(
      <AdminRecordTable aria-label='Contacts' head={head} columnCount={2} rowCount={0} isLoading>
        {null}
      </AdminRecordTable>
    );
    expect(screen.getAllByTestId('admin-skeleton-row')).toHaveLength(5);
    expect(screen.getByRole('region', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(
      <AdminRecordTable aria-label='Contacts' head={head} columnCount={2} rowCount={0} isLoading={false}>
        {null}
      </AdminRecordTable>
    );
    expect(screen.queryByTestId('admin-skeleton-row')).toBeNull();
    expect(screen.getByText('No records match the current filters.')).toBeInTheDocument();
  });

  it('keeps rows visible while refreshing and exposes filters, errors, and load more', () => {
    const onLoadMore = vi.fn();
    render(
      <AdminRecordTable
        aria-label='Contacts'
        head={head}
        columnCount={2}
        rowCount={1}
        isLoading
        hasMore
        onLoadMore={onLoadMore}
        error='Boom'
        filters={<AdminFilterBar summary='filters here' />}
      >
        <tr>
          <AdminDataTableCell />
          <AdminDataTableCell>Ada</AdminDataTableCell>
        </tr>
      </AdminRecordTable>
    );
    expect(screen.getByText('filters here')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing...');
    expect(screen.queryByTestId('admin-skeleton-row')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe('AdminSkeletonRows', () => {
  it('renders the requested number of placeholder rows and cells', () => {
    render(
      <table>
        <tbody>
          <AdminSkeletonRows columnCount={3} rows={2} />
        </tbody>
      </table>
    );
    const rows = screen.getAllByTestId('admin-skeleton-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('td')).toHaveLength(3);
  });
});

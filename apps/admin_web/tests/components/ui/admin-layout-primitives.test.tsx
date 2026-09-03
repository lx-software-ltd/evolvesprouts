import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminEditorCard } from '@/components/ui/admin-editor-card';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { AdminTableToolbar } from '@/components/ui/admin-table-toolbar';
import { PaginatedTableCard } from '@/components/ui/paginated-table-card';

describe('AdminTabStrip', () => {
  it('renders a button group with aria-pressed on the active view', () => {
    const onChange = vi.fn();
    render(
      <AdminTabStrip
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' },
        ]}
        activeKey='a'
        onChange={onChange}
        aria-label='Finance views'
      />
    );
    expect(screen.getByRole('group', { name: 'Finance views' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('AdminEditorCard', () => {
  it('renders title, description, fields, and a left-aligned actions row', () => {
    render(
      <AdminEditorCard title='New tag' description='Create a tag' actions={<button type='button'>Save</button>}>
        <input aria-label='Name' />
      </AdminEditorCard>
    );
    expect(screen.getByText('New tag')).toBeInTheDocument();
    expect(screen.getByText('Create a tag')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    const actionsRow = screen.getByRole('button', { name: 'Save' }).parentElement;
    expect(actionsRow).toHaveClass('justify-start', 'gap-2');
  });

  it('omits the actions row when no actions are given', () => {
    const { container } = render(
      <AdminEditorCard title='Read only'>
        <p>body</p>
      </AdminEditorCard>
    );
    expect(container.querySelector('.justify-start')).toBeNull();
  });
});

describe('AdminTableToolbar', () => {
  it('lays controls out in one wrapping row with a default bottom margin', () => {
    const { container, rerender } = render(
      <AdminTableToolbar>
        <span>filters</span>
      </AdminTableToolbar>
    );
    const row = container.firstElementChild;
    expect(row).toHaveClass('flex', 'flex-wrap', 'items-end', 'gap-3', 'mb-3');
    rerender(
      <AdminTableToolbar marginBottom='none'>
        <span>filters</span>
      </AdminTableToolbar>
    );
    expect(container.firstElementChild).not.toHaveClass('mb-3');
  });
});

describe('PaginatedTableCard', () => {
  it('shows toolbar, error banner, loading text, and load-more control', () => {
    const onLoadMore = vi.fn();
    render(
      <PaginatedTableCard
        title='Tags'
        isLoading
        isLoadingMore={false}
        hasMore
        error='Failed'
        toolbar={<div>toolbar</div>}
        onLoadMore={onLoadMore}
      >
        <table />
      </PaginatedTableCard>
    );
    expect(screen.getByText('toolbar')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hides load-more when there is no next page and disables it while loading more', () => {
    const { rerender } = render(
      <PaginatedTableCard title='Tags' isLoading={false} isLoadingMore={false} hasMore={false} error='' onLoadMore={() => undefined}>
        <table />
      </PaginatedTableCard>
    );
    expect(screen.queryByRole('button', { name: /Load/ })).toBeNull();
    rerender(
      <PaginatedTableCard title='Tags' isLoading={false} isLoadingMore hasMore error='' onLoadMore={() => undefined}>
        <table />
      </PaginatedTableCard>
    );
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });
});

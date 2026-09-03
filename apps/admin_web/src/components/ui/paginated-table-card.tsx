'use client';

import type { ReactNode } from 'react';

import { StatusBanner } from '@/components/status-banner';

import { Button } from './button';
import { Card } from './card';

export interface PaginatedTableCardProps {
  title: string;
  description?: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadingLabel?: string;
  onLoadMore: () => Promise<void> | void;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function PaginatedTableCard({
  title,
  description,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  loadingLabel = 'Loading...',
  onLoadMore,
  toolbar,
  children,
}: PaginatedTableCardProps) {
  return (
    <Card title={title} description={description}>
      {toolbar}
      {error ? (
        <div className='mb-2'>
          <StatusBanner variant='error' title={title}>
            {error}
          </StatusBanner>
        </div>
      ) : null}
      <div className='overflow-x-auto'>
        {children}
      </div>
      {isLoading ? <p className='mt-3 text-sm text-slate-500'>{loadingLabel}</p> : null}
      {hasMore ? (
        <div className='mt-3'>
          <Button
            type='button'
            variant='outline'
            onClick={() => void onLoadMore()}
            loading={isLoadingMore}
            loadingLabel='Loading…'
          >
            Load more
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

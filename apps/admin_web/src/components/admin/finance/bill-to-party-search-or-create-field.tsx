'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  searchBillToParties,
  type BillToPartyKind,
  type BillToPartyValue,
} from '@/lib/bill-to-party-api';
import { BILL_TO_PARTY_SEARCH_MIN_CHARS } from '@/lib/parse-contact-search-query';
import type { EntityPickerListItem } from '@/lib/entity-api';

const SEARCH_DEBOUNCE_MS = 300;

export function billToPartyKindNoun(kind: BillToPartyKind): string {
  if (kind === 'contact') {
    return 'contact';
  }
  if (kind === 'family') {
    return 'family';
  }
  if (kind === 'partner') {
    return 'partner';
  }
  return 'organization';
}

export function billToPartyFieldLabel(kind: BillToPartyKind): string {
  if (kind === 'contact') {
    return 'Contact';
  }
  if (kind === 'family') {
    return 'Family';
  }
  if (kind === 'partner') {
    return 'Partner organization';
  }
  return 'Organization';
}

function billToPartyPlaceholder(kind: BillToPartyKind): string {
  if (kind === 'contact') {
    return 'Type at least 2 characters (name, email, phone)';
  }
  if (kind === 'family') {
    return 'Type at least 2 characters (family or member name, email)';
  }
  return 'Type at least 2 characters (name)';
}

export interface BillToPartySearchOrCreateFieldProps {
  kind: BillToPartyKind;
  inputId: string;
  disabled?: boolean;
  enabled?: boolean;
  value: BillToPartyValue;
  onChange: (value: BillToPartyValue) => void;
}

export function BillToPartySearchOrCreateField({
  kind,
  inputId,
  disabled = false,
  enabled = true,
  value,
  onChange,
}: BillToPartySearchOrCreateFieldProps) {
  const listboxId = useId();
  const noun = billToPartyKindNoun(kind);
  const label = billToPartyFieldLabel(kind);
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<EntityPickerListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const blurCloseTimer = useRef<number | null>(null);
  const previousStatus = useRef(value.status);

  useEffect(() => {
    setInputValue('');
    setResults([]);
    setHighlightIndex(0);
    setOpen(false);
    setSearchError('');
  }, [kind]);

  useEffect(() => {
    if (value.status === 'existing') {
      setInputValue(value.label);
    } else if (value.status === 'empty' && previousStatus.current !== 'empty') {
      setInputValue('');
    }
    previousStatus.current = value.status;
  }, [value]);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    const q = inputValue.trim();
    if (value.status === 'existing' && q === value.label.trim()) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    if (q.length < BILL_TO_PARTY_SEARCH_MIN_CHARS) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const items = await searchBillToParties(kind, q);
          if (!cancelled) {
            setResults(items);
            setSearchError('');
            setHighlightIndex(0);
          }
        } catch (caught) {
          if (!cancelled) {
            setResults([]);
            setSearchError(caught instanceof Error ? caught.message : 'Search failed.');
          }
        } finally {
          if (!cancelled) {
            setSearching(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [enabled, inputValue, kind, value]);

  const showCreateRow = inputValue.trim().length >= BILL_TO_PARTY_SEARCH_MIN_CHARS;
  const optionCount = results.length + (showCreateRow ? 1 : 0);
  const isNew = value.status === 'create';
  const listOpen = open && enabled && !disabled && optionCount > 0;

  const activeDescendant = useMemo(() => {
    if (!listOpen || optionCount === 0) {
      return undefined;
    }
    const idx = Math.min(Math.max(highlightIndex, 0), optionCount - 1);
    if (idx < results.length) {
      return `${listboxId}-opt-${results[idx].id}`;
    }
    return `${listboxId}-create`;
  }, [highlightIndex, listOpen, listboxId, optionCount, results]);

  const commitQuery = (next: string) => {
    setInputValue(next);
    const trimmed = next.trim();
    if (trimmed.length >= BILL_TO_PARTY_SEARCH_MIN_CHARS) {
      onChange({ status: 'create', query: trimmed });
    } else {
      onChange({ status: 'empty' });
    }
  };

  const selectExisting = (item: EntityPickerListItem) => {
    onChange({ status: 'existing', id: item.id, label: item.label });
    setInputValue(item.label);
    setOpen(false);
  };

  const selectCreate = () => {
    const trimmed = inputValue.trim();
    if (trimmed.length < BILL_TO_PARTY_SEARCH_MIN_CHARS) {
      onChange({ status: 'empty' });
      return;
    }
    onChange({ status: 'create', query: trimmed });
    setOpen(false);
  };

  const clearBlurTimer = () => {
    if (blurCloseTimer.current !== null) {
      window.clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  };

  return (
    <div className='min-w-[260px] flex-1'>
      <div className='mb-1 flex items-center gap-2'>
        <Label htmlFor={inputId} className='mb-0'>
          {label}
        </Label>
        {isNew ? (
          <span className='rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900'>
            New {noun}
          </span>
        ) : null}
      </div>
      <div className='relative'>
        <Input
          id={inputId}
          role='combobox'
          aria-expanded={listOpen}
          aria-controls={listboxId}
          aria-autocomplete='list'
          aria-activedescendant={activeDescendant}
          autoComplete='off'
          disabled={disabled || !enabled}
          value={inputValue}
          placeholder={billToPartyPlaceholder(kind)}
          className={clsx(isNew && 'border-amber-500 focus:border-amber-600 focus:ring-amber-500')}
          onChange={(e) => {
            commitQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            clearBlurTimer();
            setOpen(true);
          }}
          onBlur={() => {
            clearBlurTimer();
            blurCloseTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (!listOpen) {
              if (e.key === 'ArrowDown' && optionCount > 0) {
                e.preventDefault();
                setOpen(true);
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIndex((prev) => Math.min(prev + 1, optionCount - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIndex((prev) => Math.max(prev - 1, 0));
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const idx = Math.min(Math.max(highlightIndex, 0), optionCount - 1);
              if (idx < results.length) {
                selectExisting(results[idx]);
              } else {
                selectCreate();
              }
            }
          }}
        />
        {listOpen ? (
          <ul
            id={listboxId}
            role='listbox'
            className='absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-md'
          >
            {results.map((item, index) => {
              const active = highlightIndex === index;
              return (
                <li
                  key={item.id}
                  id={`${listboxId}-opt-${item.id}`}
                  role='option'
                  aria-selected={value.status === 'existing' && value.id === item.id}
                  className={clsx(
                    'cursor-pointer px-3 py-2 text-sm text-slate-900',
                    active ? 'bg-slate-100' : 'bg-white',
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => selectExisting(item)}
                >
                  {item.label}
                </li>
              );
            })}
            {showCreateRow ? (
              <li
                id={`${listboxId}-create`}
                role='option'
                aria-selected={isNew}
                className={clsx(
                  'cursor-pointer px-3 py-2 text-sm font-medium text-amber-950',
                  highlightIndex === results.length ? 'bg-amber-100' : 'bg-amber-50',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlightIndex(results.length)}
                onClick={selectCreate}
              >
                Create new {noun}: {inputValue.trim()}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {searching ? <p className='mt-1 text-xs text-slate-500'>Searching…</p> : null}
      {searchError ? (
        <p className='mt-1 text-sm text-red-700' role='alert'>
          {searchError}
        </p>
      ) : null}
      {isNew ? (
        <p className='mt-1 text-xs text-amber-800'>
          No existing {noun} selected. A new {noun} will be created when you create the draft.
        </p>
      ) : null}
    </div>
  );
}

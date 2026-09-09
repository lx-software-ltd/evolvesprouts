'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { searchEntityContactsForPicker, type EntityPickerListItem } from '@/lib/entity-api';
import { BILL_TO_PARTY_SEARCH_MIN_CHARS } from '@/lib/parse-contact-search-query';

const SEARCH_DEBOUNCE_MS = 300;

export type SelectedContactValue =
  | { status: 'empty' }
  | { status: 'selected'; id: string; label: string };

export interface AdminContactSearchFieldProps {
  inputId: string;
  value: SelectedContactValue;
  onChange: (value: SelectedContactValue) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  label?: string;
  className?: string;
}

export function AdminContactSearchField({
  inputId,
  value,
  onChange,
  disabled = false,
  hideLabel = false,
  label = 'Contact',
  className,
}: AdminContactSearchFieldProps) {
  const listboxId = useId();
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<EntityPickerListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const blurCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (value.status === 'selected') {
      setInputValue(value.label);
    } else {
      setInputValue('');
    }
  }, [value]);

  useEffect(() => {
    const q = inputValue.trim();
    if (value.status === 'selected' && q === value.label.trim()) {
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
          const items = await searchEntityContactsForPicker({ query: q, limit: 50 });
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
  }, [inputValue, value]);

  const listOpen = open && !disabled && results.length > 0;
  const activeDescendant = useMemo(() => {
    if (!listOpen || results.length === 0) {
      return undefined;
    }
    const idx = Math.min(Math.max(highlightIndex, 0), results.length - 1);
    return `${listboxId}-opt-${results[idx].id}`;
  }, [highlightIndex, listOpen, listboxId, results]);

  const selectExisting = (item: EntityPickerListItem) => {
    onChange({ status: 'selected', id: item.id, label: item.label });
    setInputValue(item.label);
    setOpen(false);
  };

  const clearBlurTimer = () => {
    if (blurCloseTimer.current !== null) {
      window.clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  };

  return (
    <div className={clsx('min-w-0', className)}>
      {hideLabel ? null : (
        <Label htmlFor={inputId} className='mb-1'>
          {label}
        </Label>
      )}
      <div className='relative'>
        <Input
          id={inputId}
          role='combobox'
          aria-expanded={listOpen}
          aria-controls={listboxId}
          aria-autocomplete='list'
          aria-activedescendant={activeDescendant}
          autoComplete='off'
          disabled={disabled}
          value={inputValue}
          placeholder='Type at least 2 characters (name, email, phone)'
          onChange={(event) => {
            const next = event.target.value;
            setInputValue(next);
            setOpen(true);
            if (value.status === 'selected' && next.trim() !== value.label.trim()) {
              onChange({ status: 'empty' });
            }
            if (next.trim().length < BILL_TO_PARTY_SEARCH_MIN_CHARS) {
              onChange({ status: 'empty' });
            }
          }}
          onFocus={() => {
            clearBlurTimer();
            setOpen(true);
          }}
          onBlur={() => {
            clearBlurTimer();
            blurCloseTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(event) => {
            if (!listOpen) {
              if (event.key === 'ArrowDown' && results.length > 0) {
                event.preventDefault();
                setOpen(true);
              }
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlightIndex((prev) => Math.max(prev - 1, 0));
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const idx = Math.min(Math.max(highlightIndex, 0), results.length - 1);
              const picked = results[idx];
              if (picked) {
                selectExisting(picked);
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
                  aria-selected={value.status === 'selected' && value.id === item.id}
                  className={clsx(
                    'cursor-pointer px-3 py-2 text-sm text-slate-900',
                    active ? 'bg-slate-100' : 'bg-white',
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => selectExisting(item)}
                >
                  {item.label}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {searching ? <p className='mt-1 text-xs text-slate-500'>Searching…</p> : null}
      {searchError ? (
        <p className='mt-1 text-sm text-red-700' role='alert'>
          {searchError}
        </p>
      ) : null}
    </div>
  );
}

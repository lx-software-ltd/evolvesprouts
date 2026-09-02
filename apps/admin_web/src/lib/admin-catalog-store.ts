export type AdminCatalogKey =
  | 'entityTags'
  | 'adminUsers'
  | 'geographicAreas'
  | 'instructorUsers'
  | 'pickerLocations'
  | 'venueLocations';

export interface AdminCatalogEntry<TItem> {
  items: TItem[];
  error: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

type CatalogListener = () => void;

const listeners = new Set<CatalogListener>();
const entries = new Map<AdminCatalogKey, AdminCatalogEntry<unknown>>();
const inflight = new Map<AdminCatalogKey, Promise<void>>();

function emptyEntry<TItem>(): AdminCatalogEntry<TItem> {
  return { items: [], error: '', status: 'idle' };
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function getAdminCatalogEntry<TItem>(key: AdminCatalogKey): AdminCatalogEntry<TItem> {
  const existing = entries.get(key) as AdminCatalogEntry<TItem> | undefined;
  if (existing) {
    return existing;
  }
  const created = emptyEntry<TItem>();
  entries.set(key, created as AdminCatalogEntry<unknown>);
  return created;
}

export function subscribeAdminCatalog(listener: CatalogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function invalidateAdminCatalog(key: AdminCatalogKey): void {
  inflight.delete(key);
  entries.set(key, emptyEntry());
  emit();
}

export async function ensureAdminCatalog<TItem>(
  key: AdminCatalogKey,
  fetcher: () => Promise<TItem[]>,
  options: { force?: boolean } = {}
): Promise<void> {
  if (options.force) {
    inflight.delete(key);
  } else {
    const current = getAdminCatalogEntry<TItem>(key);
    if (current.status === 'ready') {
      return;
    }
    const pending = inflight.get(key);
    if (pending) {
      await pending;
      return;
    }
  }

  entries.set(key, {
    ...getAdminCatalogEntry<TItem>(key),
    status: 'loading',
    error: '',
  });
  emit();

  const request = fetcher()
    .then((items) => {
      if (inflight.get(key) !== request) {
        return;
      }
      entries.set(key, { items, error: '', status: 'ready' });
    })
    .catch((caught: unknown) => {
      if (inflight.get(key) !== request) {
        return;
      }
      const message = caught instanceof Error ? caught.message : 'Failed to load catalog.';
      entries.set(key, {
        items: getAdminCatalogEntry<TItem>(key).items,
        error: message,
        status: 'error',
      });
    })
    .finally(() => {
      if (inflight.get(key) === request) {
        inflight.delete(key);
      }
      emit();
    });

  inflight.set(key, request);
  await request;
}

export function resetAdminCatalogStoreForTests(): void {
  entries.clear();
  inflight.clear();
  emit();
}

const INSERT_LIKE_ACTIONS = new Set([
  'INSERT',
  'DRAFT_CREATED',
  'DRAFT_CREATED_CUSTOMIZED',
]);

const DELETE_LIKE_ACTIONS = new Set([
  'DELETE',
  'DELETE_DRAFT',
  'VOID_FROM_DRAFT',
  'VOID_FROM_ISSUED',
]);

export function actionBadgeClassName(action: string): string {
  if (INSERT_LIKE_ACTIONS.has(action)) {
    return 'bg-green-100 text-green-800';
  }
  if (action === 'UPDATE') {
    return 'bg-blue-100 text-blue-800';
  }
  if (DELETE_LIKE_ACTIONS.has(action)) {
    return 'bg-red-100 text-red-800';
  }
  return 'bg-slate-100 text-slate-700';
}

export function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${actionBadgeClassName(action)}`}
    >
      {action}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    trigger: 'bg-slate-100 text-slate-700',
    application: 'bg-purple-100 text-purple-700',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[source] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {source}
    </span>
  );
}

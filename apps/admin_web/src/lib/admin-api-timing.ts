/**
 * Development-only request timing for the admin API. Pairs the browser-side
 * duration with the Lambda's `Server-Timing` header (`app;dur=…` handler time,
 * `cold;dur=…` on the container's first invocation) so slow loads can be split
 * into network, cold start, and handler time from the console alone.
 */
export interface AdminApiTimingSample {
  method: string;
  endpointPath: string;
  status: number;
  totalMs: number;
  serverTiming: string | null;
}

export function formatAdminApiTiming(sample: AdminApiTimingSample): string {
  const server = sample.serverTiming ? ` server[${sample.serverTiming}]` : '';
  return `[admin-api] ${sample.method} ${sample.endpointPath} ${sample.status} ${Math.round(sample.totalMs)}ms${server}`;
}

export function reportAdminApiTiming(sample: AdminApiTimingSample): void {
  if (process.env.NODE_ENV === 'production' || typeof console === 'undefined') {
    return;
  }
  console.debug(formatAdminApiTiming(sample));
}

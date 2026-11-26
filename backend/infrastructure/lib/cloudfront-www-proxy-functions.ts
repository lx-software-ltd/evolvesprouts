/**
 * Shared CloudFront Function (JS 2.0) sources for static-export sites that
 * proxy allowlisted /api/v1/public/ routes. Used by public-www-stack and
 * training-stack; keep in sync with docs/architecture/security.md.
 */

/**
 * Rewrite extensionless paths to index.html for Next.js static export.
 * Training uses this constant as-is. Both public website distributions wrap
 * it with the edge-verify call. `functions/public-www-path-rewrite.js`
 * is the fixture the copied size test reads and is not deployed. From
 * `function handler` onward it must match that wrap. See `functions/README.md`.
 */
export const STATIC_EXPORT_PATH_REWRITE_FUNCTION = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Never rewrite Next.js static asset requests.
  if (uri.startsWith('/_next/')) {
    return request;
  }

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  if (uri.indexOf('.') === -1) {
    request.uri = uri + '/index.html';
  }

  return request;
}
`;

/** One route list for the /api viewer allow-list. Old /www viewer paths stay removed. */
export interface ProxyAllowlistEntry {
  readonly methods: readonly string[];
  readonly apiPath: string;
  /** Exact public.yaml path, or a prefix of one for a wildcard rule. */
  readonly publicPath: string;
  readonly kind: "exact" | "prefix";
  readonly suffix?: string;
  readonly contains?: string;
  readonly name?: string;
}

export const PROXY_ALLOWLIST_ENTRIES: readonly ProxyAllowlistEntry[] = [
  {
    kind: "exact",
    methods: ["GET"],
    apiPath: "/api/v1/public/calendar",
    publicPath: "/v1/public/calendar",
  },
  {
    kind: "exact",
    methods: ["GET"],
    apiPath: "/api/v1/public/calendar/availability",
    publicPath: "/v1/public/calendar/availability",
  },
  {
    kind: "exact",
    methods: ["GET"],
    apiPath: "/api/v1/public/assets/free",
    publicPath: "/v1/public/assets/free",
  },
  {
    kind: "exact",
    methods: ["POST"],
    apiPath: "/api/v1/public/discounts/validate",
    publicPath: "/v1/public/discounts/validate",
  },
  {
    kind: "exact",
    methods: ["POST"],
    apiPath: "/api/v1/public/reservations",
    publicPath: "/v1/public/reservations",
  },
  {
    kind: "exact",
    methods: ["POST"],
    apiPath: "/api/v1/public/reservations/payment-intent",
    publicPath: "/v1/public/reservations/payment-intent",
  },
  {
    kind: "exact",
    methods: ["POST"],
    apiPath: "/api/v1/public/contact-us",
    publicPath: "/v1/public/contact-us",
  },
  {
    kind: "prefix",
    name: "isFormAnswersPath",
    methods: ["PUT", "OPTIONS"],
    apiPath: "/api/v1/public/forms/",
    publicPath: "/v1/public/forms/",
    suffix: "/answers",
  },
  {
    kind: "prefix",
    name: "isFormContactContextPath",
    methods: ["GET", "OPTIONS"],
    apiPath: "/api/v1/public/forms/",
    publicPath: "/v1/public/forms/",
    suffix: "/contact-context",
  },
  {
    kind: "prefix",
    name: "isPollAnswersPath",
    methods: ["GET", "PUT", "OPTIONS"],
    apiPath: "/api/v1/public/polls/",
    publicPath: "/v1/public/polls/",
    suffix: "/answers",
  },
  {
    kind: "prefix",
    name: "isPollQuestionResultsPath",
    methods: ["GET", "OPTIONS"],
    apiPath: "/api/v1/public/polls/",
    publicPath: "/v1/public/polls/",
    suffix: "/results",
    contains: "/questions/",
  },
  {
    kind: "prefix",
    name: "isPollControlPath",
    methods: ["GET", "PUT", "OPTIONS"],
    apiPath: "/api/v1/public/polls/",
    publicPath: "/v1/public/polls/",
    suffix: "/control",
  },
];

function quoteJs(value: string): string {
  return `'${value}'`;
}

function methodCheck(methods: readonly string[]): string {
  return methods.map((method) => `method === '${method}'`).join(" || ");
}

function renderApiAllowlist(): string {
  const exactByMethod = new Map<string, string[]>();
  for (const entry of PROXY_ALLOWLIST_ENTRIES) {
    if (entry.kind !== "exact") {
      continue;
    }
    for (const method of entry.methods) {
      const paths = exactByMethod.get(method) ?? [];
      paths.push(entry.apiPath);
      exactByMethod.set(method, paths);
    }
  }
  const methodBlocks = [...exactByMethod.entries()].map(([method, paths], methodIndex, all) => {
    const lines = paths.map((item, index) => {
      const comma = index === paths.length - 1 ? "" : ",";
      return `      ${quoteJs(item)}: true${comma}`;
    });
    const methodComma = methodIndex === all.length - 1 ? "" : ",";
    return `    '${method}': {\n${lines.join("\n")}\n    }${methodComma}`;
  });
  const prefixBlocks = PROXY_ALLOWLIST_ENTRIES.filter((entry) => entry.kind === "prefix").map(
    (entry) => {
      const suffix = entry.suffix ?? "";
      const contains = entry.contains
        ? `\n    && uri.indexOf(${quoteJs(entry.contains)}) > 0`
        : "";
      const checks = methodCheck(entry.methods);
      const wrapped = entry.methods.length > 1 ? `(${checks})` : checks;
      return `  var ${entry.name} =
    uri.indexOf(${quoteJs(entry.apiPath)}) === 0${contains} &&
    uri.lastIndexOf(${quoteJs(suffix)}) === uri.length - ${suffix.length};
  if (
    ${wrapped} &&
    ${entry.name}
  ) {
    request.uri = uri.substring(4);
    return request;
  }`;
    },
  );
  return `function handler(event) {
  var request = event.request;
  var method = request.method || '';
  var uri = request.uri || '';

  var allowlist = {
${methodBlocks.join("\n")}
  };
  if (allowlist[method] && allowlist[method][uri]) {
    request.uri = uri.substring(4);
    return request;
  }

${prefixBlocks.join("\n\n")}

  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' }
    },
    body: '{"message":"Forbidden"}'
  };
}
`;
}

/** Default-deny allowlist for /api/v1/public/... . The viewer path loses the /api prefix. */
export const API_PROXY_ALLOWLIST_FUNCTION = renderApiAllowlist();

/** Convert HTML error pages from API origins to JSON for /api proxy behaviors. */
export const WWW_API_ERROR_RESPONSE_FUNCTION = `
function handler(event) {
  var response = event.response;
  var statusCode = parseInt(response.statusCode, 10);
  if (statusCode < 400 || statusCode >= 600) {
    return response;
  }
  var ct = response.headers['content-type'];
  var contentType = (ct && ct.value) ? ct.value : '';
  if (contentType.indexOf('text/html') !== -1) {
    response.statusCode = 502;
    response.statusDescription = 'Bad Gateway';
    response.headers['content-type'] = { value: 'application/json; charset=utf-8' };
    response.headers['cache-control'] = { value: 'no-store' };
    response.body = '{"error":"The request could not be processed. Please try again."}';
  }
  return response;
}
`;

/** POST/OPTIONS /api/v1/public/assets/free/request keeps the /v1/public path. */
export const API_MEDIA_REQUEST_PROXY_FUNCTION = `
function handler(event) {
  var request = event.request;
  var method = request.method || '';
  var uri = request.uri || '';
  var isAllowedMethod = method === 'POST' || method === 'OPTIONS';

  if (uri === '/api/v1/public/assets/free/request' && isAllowedMethod) {
    request.uri = '/v1/public/assets/free/request';
    return request;
  }

  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: {
      'content-type': { value: 'application/json; charset=utf-8' },
      'cache-control': { value: 'no-store' }
    },
    body: '{"message":"Forbidden"}'
  };
}
`;

import {
  MEDIA_REQUEST_PROXY_FUNCTION,
  STATIC_EXPORT_PATH_REWRITE_FUNCTION,
  WWW_API_ERROR_RESPONSE_FUNCTION,
  WWW_PROXY_ALLOWLIST_FUNCTION,
} from "../lib/cloudfront-www-proxy-functions";

const REQUIRED_ALLOWLIST_PATHS = [
  "/www/v1/calendar/public",
  "/www/v1/calendar/availability",
  "/www/v1/assets/free",
  "/www/v1/discounts/validate",
  "/www/v1/reservations",
  "/www/v1/reservations/payment-intent",
  "/www/v1/contact-us",
];

const REQUIRED_FORM_PUT_PREFIX = "/www/v1/forms/";
const REQUIRED_POLL_PUT_PREFIX = "/www/v1/polls/";
const REQUIRED_POLL_PUT_SUFFIX = "/answers";
const REQUIRED_POLL_RESULTS_SEGMENT = "/questions/";
const REQUIRED_POLL_RESULTS_SUFFIX = "/results";
const REQUIRED_POLL_CONTROL_SUFFIX = "/control";

function assertContainsAll(haystack: string, needles: string[], label: string): void {
  for (const needle of needles) {
    if (!haystack.includes(needle)) {
      throw new Error(`${label} missing allowlist path: ${needle}`);
    }
  }
}

function main(): void {
  for (const source of [
    STATIC_EXPORT_PATH_REWRITE_FUNCTION,
    WWW_PROXY_ALLOWLIST_FUNCTION,
    MEDIA_REQUEST_PROXY_FUNCTION,
    WWW_API_ERROR_RESPONSE_FUNCTION,
  ]) {
    if (!source.includes("function handler(event)")) {
      throw new Error("CloudFront function source missing handler");
    }
  }

  assertContainsAll(
    WWW_PROXY_ALLOWLIST_FUNCTION,
    REQUIRED_ALLOWLIST_PATHS,
    "WWW_PROXY_ALLOWLIST_FUNCTION",
  );

  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes(REQUIRED_FORM_PUT_PREFIX)) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing form PUT prefix allowlist rule",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes(REQUIRED_POLL_PUT_PREFIX)) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing poll PUT prefix allowlist rule",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes(REQUIRED_POLL_PUT_SUFFIX)) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing poll PUT /answers suffix rule",
    );
  }
  if (
    !WWW_PROXY_ALLOWLIST_FUNCTION.includes("method === 'GET'") ||
    !WWW_PROXY_ALLOWLIST_FUNCTION.includes("isPollAnswersPath")
  ) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing poll GET /answers allowlist rule",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes("method === 'OPTIONS'")) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION must allow OPTIONS for poll answer preflight",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes(REQUIRED_POLL_RESULTS_SEGMENT)) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing poll GET /questions/ segment rule",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes(REQUIRED_POLL_RESULTS_SUFFIX)) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing poll GET /results suffix rule",
    );
  }
  if (!WWW_PROXY_ALLOWLIST_FUNCTION.includes("/contact-context")) {
    throw new Error(
      "WWW_PROXY_ALLOWLIST_FUNCTION missing form GET /contact-context allowlist rule",
    );
  }

  if (!MEDIA_REQUEST_PROXY_FUNCTION.includes("/www/v1/assets/free/request")) {
    throw new Error("MEDIA_REQUEST_PROXY_FUNCTION missing media request path");
  }

  console.log("cloudfront-www-proxy-functions.test.ts: ok");
}

main();

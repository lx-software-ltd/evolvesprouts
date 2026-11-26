"""Read-only checks before an API cutover.

Prints ``skipped`` and exits 0 when ``API_CUTOVER_CUSTOM_DOMAIN_URL`` or
``API_CUTOVER_SITE_BUNDLE_URL`` is unset. When both are set, it GETs those
URLs and checks four preconditions:

- the custom domain responds
- the check does not call or require an execute-api hostname
- the site bundle has no ``/www/v1``
- the legacy token header is not required

No AWS calls and no writes. Do not point the URLs at production from an
unattended run.
"""

from __future__ import annotations

import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CUSTOM_DOMAIN_URL_ENV = "API_CUTOVER_CUSTOM_DOMAIN_URL"
SITE_BUNDLE_URL_ENV = "API_CUTOVER_SITE_BUNDLE_URL"
_EXECUTE_API_MARKER = "execute-api"
_WWW_V1_MARKER = "/www/v1"
_LEGACY_HEADER_MARKER = "x-api-token"


def custom_domain_responds(status_code: int) -> str | None:
    """Return a finding when the custom domain did not answer."""
    if 200 <= status_code < 400:
        return None
    return f"custom domain status {status_code}"


def execute_api_not_required(url: str, body: str) -> str | None:
    """Return a finding when the check would depend on execute-api."""
    if _EXECUTE_API_MARKER in url.lower() or _EXECUTE_API_MARKER in body.lower():
        return "execute-api is still required"
    return None


def site_bundle_has_no_www_v1(body: str) -> str | None:
    """Return a finding when a site bundle still names the old public prefix."""
    if _WWW_V1_MARKER in body:
        return "site bundle still contains /www/v1"
    return None


def legacy_header_not_required(body: str) -> str | None:
    """Return a finding when a body still requires the retired token header."""
    if _LEGACY_HEADER_MARKER in body.lower():
        return "legacy token header is still required"
    return None


def _read(url: str) -> tuple[int, str]:
    request = Request(url, method="GET")
    try:
        with urlopen(request, timeout=10) as response:
            payload = response.read(1_000_000)
            return int(response.status), payload.decode("utf-8", errors="replace")
    except HTTPError as exc:
        payload = exc.read(1_000_000)
        return int(exc.code), payload.decode("utf-8", errors="replace")


def main() -> int:
    """Run the checks, or skip when the URL env vars are unset."""
    custom_url = os.environ.get(CUSTOM_DOMAIN_URL_ENV, "").strip()
    bundle_url = os.environ.get(SITE_BUNDLE_URL_ENV, "").strip()
    if not custom_url or not bundle_url:
        print("skipped")
        return 0

    findings: list[str] = []
    for url in (custom_url, bundle_url):
        finding = execute_api_not_required(url, "")
        if finding is not None:
            findings.append(finding)
    if findings:
        for finding in findings:
            print(finding)
        return 1

    try:
        status_code, custom_body = _read(custom_url)
        _bundle_status, bundle_body = _read(bundle_url)
    except (URLError, TimeoutError, OSError) as exc:
        print(f"custom domain did not respond: {type(exc).__name__}")
        return 1

    checks = (
        custom_domain_responds(status_code),
        execute_api_not_required(custom_url, custom_body),
        execute_api_not_required(bundle_url, bundle_body),
        site_bundle_has_no_www_v1(bundle_body),
        legacy_header_not_required(custom_body + "\n" + bundle_body),
    )
    findings = [finding for finding in checks if finding is not None]
    if findings:
        for finding in findings:
            print(finding)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

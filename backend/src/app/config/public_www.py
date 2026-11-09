"""Public-WWW config helper with Secrets Manager fallback.

The admin Lambda's combined environment-variable string is bounded by
AWS at 4 KB. The 16 ``PUBLIC_WWW_*`` values used by AR invoice
rendering, transactional email templates, and Stripe payment routing
push us past that limit, so CDK packs them into a single Secrets
Manager JSON secret and ships only ``PUBLIC_WWW_CONFIG_SECRET_ARN`` to
the Lambda.

Lookup order (env-var first so existing
``monkeypatch.setenv("PUBLIC_WWW_*", ...)`` tests stay green):

1. ``PUBLIC_WWW_<suffix>`` environment variable.
2. JSON object stored in the secret pointed at by
   ``PUBLIC_WWW_CONFIG_SECRET_ARN``; key is ``<suffix>``.
3. Caller-supplied default.
"""

from __future__ import annotations

import os

from app.services.secrets import get_secret_json
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Environment variable name, not a secret value.
_SECRET_ARN_ENV_VAR = (  # nosec B105
    "PUBLIC_WWW_CONFIG_SECRET_ARN"
)


def get_public_www(suffix: str, default: str = "") -> str:
    """Return the configured ``PUBLIC_WWW_<suffix>`` value.

    Empty values are treated as unset and fall through to the next
    source. Secret-fetch failures are logged and treated as unset; the
    caller receives ``default``.
    """

    cleaned_suffix = suffix.strip()
    if not cleaned_suffix:
        return default

    env_value = os.getenv(f"PUBLIC_WWW_{cleaned_suffix}", "")
    if isinstance(env_value, str) and env_value.strip():
        return env_value

    secret_arn = os.getenv(_SECRET_ARN_ENV_VAR, "").strip()
    if not secret_arn:
        return default

    try:
        payload = get_secret_json(secret_arn)
    except Exception:
        logger.exception(
            "Failed to load PUBLIC_WWW_CONFIG secret",
            extra={"config_arn_present": True},
        )
        return default

    raw = payload.get(cleaned_suffix)
    if isinstance(raw, str) and raw.strip():
        return raw
    return default

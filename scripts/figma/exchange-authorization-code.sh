#!/usr/bin/env bash
python3 << 'PYEOF'
import json, os, sys, urllib.request, urllib.parse

client_id     = os.environ["CLIENT_ID"]
client_secret = os.environ["CLIENT_SECRET"]
auth_code     = os.environ["AUTH_CODE"].strip()
port          = os.environ.get("CALLBACK_PORT", "3845").strip()
redirect_uri  = f"http://localhost:{port}/callback"

# --- Debug (no secrets) ---
print(f"redirect_uri : {redirect_uri}")
print(f"code length  : {len(auth_code)}")
print(f"code prefix  : {auth_code[:8]}...")
print(f"client_id len: {len(client_id)}")
print()

# --- Try the exchange ---
body = urllib.parse.urlencode({
    "client_id":     client_id,
    "client_secret": client_secret,
    "redirect_uri":  redirect_uri,
    "code":          auth_code,
    "grant_type":    "authorization_code",
}).encode()

req = urllib.request.Request(
    "https://api.figma.com/v1/oauth/token",
    data=body,
    headers={"Content-Type": "application/x-www-form-urlencoded"},
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
except urllib.error.HTTPError as exc:
    err_body = exc.read().decode()[:500]
    print(f"::error::Token exchange failed (HTTP {exc.code}): {err_body}")

    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write("exchange_ok=false\n")
        f.write(f"error_detail=HTTP {exc.code}: {err_body}\n")

    sys.exit(1)

refresh_token = data.get("refresh_token", "")
access_token  = data.get("access_token", "")
expires_in    = data.get("expires_in", "?")
user_id       = data.get("user_id", "")

if not refresh_token:
    print(f"::error::No refresh_token in response: {json.dumps(data)[:500]}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write("exchange_ok=false\n")
    sys.exit(1)

# Mask the access token in logs (short-lived, not needed).
# The refresh token is written to the summary for manual copying
# and is NOT masked so it remains readable there.
if access_token:
    print(f"::add-mask::{access_token}")

with open(os.environ["GITHUB_OUTPUT"], "a") as f:
    f.write(f"exchange_ok=true\n")
    f.write(f"refresh_token={refresh_token}\n")
    f.write(f"expires_in={expires_in}\n")
    f.write(f"user_id={user_id}\n")

print()
print("Token exchange successful!")
print(f"  user_id    : {user_id}")
print(f"  expires_in : {expires_in}s")
print()
print("See the run Summary tab for the refresh token.")
PYEOF

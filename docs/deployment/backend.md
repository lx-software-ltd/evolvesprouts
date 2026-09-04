# Backend API deployment

The backend is the CDK `ApiStack` (and nested stacks) that deploys API Gateway,
Admin Lambda, and related AWS resources.

## Mailchimp webhook URL

Mailchimp audience webhooks call a fixed public URL. The handler is
`GET`/`POST /v1/mailchimp/webhook` on Admin Lambda. Auth is the shared secret
`MAILCHIMP_WEBHOOK_SECRET` (`MailchimpWebhookSecret` CDK parameter), passed as
the `token` query parameter.

**URL formula**

```text
{api-origin}/v1/mailchimp/webhook?token={MAILCHIMP_WEBHOOK_SECRET}
```

Resolve `{api-origin}` from CloudFormation outputs on the backend stack:

- Use `ApiCustomDomainUrl` when `ApiCustomDomainName` is set.
- Otherwise use `ApiUrl` (API Gateway execute-api URL).

Do not leave a previous host in the Mailchimp dashboard after
`ApiCustomDomainName` or the execute-api stage URL changes. Mailchimp will keep
calling the old URL and CRM `mailchimp_status` will drift.

### After any API host change

1. Confirm the current origin from `ApiCustomDomainUrl` or `ApiUrl`.
2. In Mailchimp: Audience → Settings → Webhooks. Set the callback URL to the
   formula above (same `token` as `CDK_PARAM_MAILCHIMP_WEBHOOK_SECRET`).
3. Verify `GET {url}` returns HTTP 200 `{"message":"ok"}`.
4. Smoke test: trigger a subscribe or unsubscribe in Mailchimp and confirm the
   contact `mailchimp_status` updates in admin.
5. Confirm the CloudWatch alarm
   `{resourcePrefix}-mailchimp-webhook-inactivity-alarm` is not in ALARM after
   traffic resumes (metric `{resourcePrefix}/Mailchimp` / `WebhookReceived`).

### Deploy checklist

- [ ] `ApiCustomDomainName` / `ApiUrl` reviewed; Mailchimp webhook URL matches
      the current API origin
- [ ] `MAILCHIMP_WEBHOOK_SECRET` unchanged unless intentionally rotated (rotate
      in Mailchimp in the same change)
- [ ] GET verification and one subscribe/unsubscribe smoke test completed

## CloudWatch inactivity alarm

CDK creates a metric filter on the Admin Lambda log group for structured log
line `Received Mailchimp webhook` (authenticated POSTs only). The alarm
`{resourcePrefix}-mailchimp-webhook-inactivity-alarm` fires when that metric is
below 1 for seven consecutive days (`TreatMissingData=breaching`).

A quiet audience can also trip this alarm. Treat it as a prompt to confirm the
Mailchimp webhook URL still matches the deployed API origin.

## Related docs

- `docs/architecture/marketing-stack.md` — Mailchimp lifecycle and webhook
  reconciliation
- `docs/architecture/setup.md` — `CDK_PARAM_MAILCHIMP_WEBHOOK_SECRET`
- `backend/infrastructure/params/README.md` — Mailchimp CDK parameters

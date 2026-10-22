# Privacy and retention

Use this when you change what account data is stored, how long it lives, or
what the privacy copy promises. Privacy copy lives in
`features/legal/content.tsx`; update `en-US` and `cs-CZ` together.

## What each system holds

| System | Holds | Removal |
| --- | --- | --- |
| Neon `auth` schema | Login email, hashed verification token with the email in its value, sessions without IP or user agent, `IP\|path` rate-limit keys | Better Auth deletes identity rows on account deletion; the daily `auth-cleanup` cron removes expired sessions, verifications, and stale rate-limit rows |
| Neon `auth` OAuth tables | Connected AI agents: client ID (its metadata URL), name, and redirect URIs; the customer's consent (client, scopes); hashed access and refresh tokens; on a rotated refresh token, the replacing token response encrypted with the Better Auth secret for the 30-second reuse window | Disconnecting an assistant removes its consent and tokens, replay copies included; consents and tokens cascade with the auth user on account deletion; the daily `auth-cleanup` cron removes expired tokens and client-assertion records and clears replay copies whose window has passed; client rows stay |
| Neon `public.customer_accounts` | Account ID, its Dotypos customer ID, deletion instant | Kept as a deleted-account tombstone so reservations keep their author; deletion clears the Dotypos customer ID |
| Neon administrator records (`account_role_grants`, account actors on CLI authentication requests and sessions, standalone access-code events, `manual_invoice_actors`, `administrator_assistant_connections`, and `administration_actions`) | Account ID, role, and the administrator's login-email snapshot as provenance; per connected AI assistant, its OAuth client ID and published name; per state-changing administration API request, the operation, its outcome, and the CLI session or assistant connection, without request input or output | Grants cascade with the auth user; actor account IDs are set to null and the email snapshot stays with the audit record; assistant connections and action records are kept as provenance, like CLI sessions, and no cleanup job removes them |
| Vercel runtime cache | Reservation details (time, table, seats, status) that customers' AI agents read, without customer fields or notes, keyed by reservation or Dotypos customer ID | Not served more than 5 minutes after its last refresh, and reservation writes expire it sooner; Vercel deletes stored entries on its own schedule |
| Dotypos | Profile and reservation history | Account deletion sets the profile's expiry; retained records stay |
| Resend | Sent message, recipient, delivery metadata | Provider retention only, and Workspace keeps no copy: 30 days for email and log data on Free, Pro, and Scale plans, plus seven-day backups. Resend publishes no sent-message delete API, so account deletion can't erase an email already sent; an exceptional early removal goes through Resend's contact process |
| Igloohome (Singapore) | Per door-code grant: the access name `Deskohub <grant-id>` (credentials requested before #780: `Deskohub <reservation-id>`), validity window, and device ID; no customer identity | Provider retention only |
| Cloudinary | Avatar asset | Destroyed before identity removal |
| PostHog warehouse | Allowlisted Dotypos customer fields in `custom.dotypos_customers` | PostHog retention settings; a Dotypos deletion arrives as `deleted: true`, not erasure |
| PostHog events | Reservation and payment step records keyed by the reservation ID, with no contact data ([lifecycle events](posthog-identity-privacy.md#reservation-and-payment-lifecycle-events)) | PostHog retention settings; an objection is handled by a manual deletion request |

## Transfers outside the EU

GDPR Chapter V inventory (Art. 13(1)(f)), checked 2026-10-20. "Transfer" means
data made available to a recipient outside the EEA, including a US company
whose terms let it access or process data stored in the EU. Adequacy-listed
countries (UK, Israel) and US companies with an active
[Data Privacy Framework](https://www.dataprivacyframework.gov/list) (DPF) entry
are covered by adequacy. Elsewhere, transfers need SCCs or another Art. 46
safeguard. Safeguards below come from each provider's published DPA and terms.
The owner decided on 2026-10-21 to rely on those published terms and not to
collect signed per-account copies.

| Provider | Personal data | Where | Chapter V status and safeguard |
| --- | --- | --- | --- |
| Vercel Inc. (US) | Every request: IP, user agent, form data; runtime logs; Analytics (consented), BotID, Queues | Functions `fra1` + `arn1` (project `serverlessFunctionRegion`, read via `vercel api /v9/projects/deskohub-workspace-site`); [DPA](https://vercel.com/legal/dpa) names the US as the primary processing location; log region unpublished | Transfer. DPF active, EU/UK/Swiss ([6847](https://www.dataprivacyframework.gov/participant/6847)); DPA Schedule 3 SCCs bind Pro accounts through the Terms |
| Neon, LLC / Databricks, Inc. (US) | All Workspace tables, including `auth` | Project `main`, `aws-eu-central-1` (Frankfurt), from `neonctl projects list` | Transfer (US staff access under the [platform terms](https://neon.com/platform-terms)). Databricks DPF entry covers Neon, LLC ([4569](https://www.dataprivacyframework.gov/participant/4569)); the legacy Neon Inc. entry lapsed on 2025-10-23. The [Databricks DPA](https://www.databricks.com/legal/databricks-data-processing-addendum) has SCCs |
| Resend (US) | Recipient, content including magic links and contact-form messages, delivery metadata | US storage whatever the sending region ([GDPR page](https://resend.com/security/gdpr), [regions](https://resend.com/docs/dashboard/domains/regions)) | Transfer. [DPA](https://resend.com/legal/dpa) SCC Module 2, signed copy under Settings → Documents; DPF EU/UK "active, re-certification under review" ([8907](https://www.dataprivacyframework.gov/participant/8907)) |
| PostHog Inc (US) | Consented events, logs, warehouse copy of Dotypos customers | EU Cloud, Frankfurt: `t.workspace.deskohub.cz` is a CNAME to `cf-prod-eu-proxy.europehog.com`; `.env.example` uses `eu.posthog.com` | Transfer (DPA allows US processing). DPF active ([2915](https://www.dataprivacyframework.gov/participant/2915)) and DPA SCC Module 2 |
| Cloudinary Inc. / Ltd. (US, Israel) | Avatar image | Treated as US (owner decision): the default unless an Enterprise data-residency add-on is bought; the config in `packages/cloudinary/src/config.ts` doesn't set a region | Transfer. DPF active ([6136](https://www.dataprivacyframework.gov/participant/6136)); Israel is adequate; the DPA has SCCs |
| Google (GTM, GA4, Ads) | IP and browser data from the GTM script request, which loads on idle or interaction regardless of consent (`features/cookie-consent/utils/tag-manager.ts`); measurement tags follow consent mode, default denied; the app sends no `user_data` or enhanced conversions | Global; Google Ireland is the EEA counterparty | Transfer to Google LLC. DPF active ([5780](https://www.dataprivacyframework.gov/participant/5780)), SCC fallback ([transfers page](https://business.safety.google/adsdatatransfers/)). GTM and GA4 are processors; Ads conversions are controller-to-controller |
| Igloocompany Pte. Ltd. (Singapore) | PIN validity window, device ID, the access name `Deskohub <grant-id>` (`makeReservationAccessName` in `features/reservation-access/reservation-access.ts`), and any lock activity Igloohome syncs. Credentials requested before #780 keep `Deskohub <reservation-id>` until they expire or are reissued | AWS outside the EEA, region unpublished ([data-act page](https://www.igloohome.co/legal/eu-data-act-compliance)) | Transfer. Singapore has no adequacy decision and Igloohome publishes no DPA or SCCs. Relies on Art. 49(1)(b): door access is necessary to perform the reservation contract (owner decision, 2026-10-21). Send only what issuing the PIN needs, so the access name carries no reservation or customer identifier (#780) |
| OpenStreetMap Foundation (UK) via Fastly (US) | Visitor IP and origin referrer from map tiles, loaded without consent (`landing-page-interactive-map.tsx`) | Fastly edge worldwide; the [OSMF privacy policy](https://osmfoundation.org/wiki/Privacy_Policy) excludes tile requests from its UK/NL storage statement | UK adequacy (renewed to 2031). Fastly has DPF and SCCs ([DPT](https://www.fastly.com/data-processing)), but OSMF's tile-log location and onward safeguard are **unpublished** |
| Nexi Central Europe a.s. (EU) | Name, email, phone, amount, order IDs; card data on the hosted page | EEA (live host `xpay.nexigroup.com`) | Not our transfer: the checkout notice names Nexi as an independent controller for payments, covering its own onward transfers (adequacy or SCCs). The merchant contract is unconfirmed |
| Dotykačka ČR s.r.o. (EU) | Customer profiles, reservations | Dotypos Cloud, CZ/EU per public statements; provider unpublished | No transfer known; no DPA or subprocessor list is public |
| Customer's AI assistant provider | Offerings, the customer's reservations, created bookings (PR #767) | Wherever the provider the customer chose runs | Disclosure at the customer's request to a recipient they chose, not our processor. §6 Recipients says the provider may be outside the EU, for example in the US, and that data goes there because the customer asked; §7 doesn't cover it (owner decision, 2026-10-21) |

Not a transfer: Google Calendar (calendar ID and time bounds only), Google
Maps (a static directions link), and accounting documents, which are rendered
in-app. Re-check this table whenever a provider, plan, or region changes.

## Rules

- Keep privacy copy to what GDPR Art. 13 requires, in plain customer
  language: which data, purposes, legal basis, recipients and transfers,
  retention period or the criteria for it, and rights. State retention as
  criteria ("expire automatically and are deleted regularly", "until you
  delete your account"), never as instant deletion on expiry, token lifetimes,
  or a cleanup cadence. Security mechanics (hashing, encryption, replay
  windows), library names, and data-model details belong in this reference,
  not in the notice. The details the notice leaves out are recorded in the
  table above, in [Better Auth configuration](better-auth-configuration.md),
  in [PostHog identity and privacy](posthog-identity-privacy.md) (agent-traffic
  fields, campaign parameters, checkout events), and in the checkout skill's
  lifecycle reference (legal-document hashes, and consent keyed per Dotypos
  customer, so a changed or shared email never moves or merges a choice).
- Current settings: 30-day rolling sessions refreshed at most daily, 10-minute
  magic-link validity, daily cleanup of expired rows, identity rows kept until
  the customer deletes the account. Connected AI agents: 1-hour access tokens,
  30-day refresh tokens rotated on use with a 30-second reuse window whose
  encrypted replay copy the daily cleanup clears, consents kept until the
  customer disconnects the assistant or deletes the account.
- The notice promises that connected assistants' access credentials expire
  automatically and are deleted regularly, that the connection and its
  permissions last until the customer disconnects the assistant in Connected
  assistants or deletes the account, and that either ends the connection and
  its permissions right away, with the access credentials stopping working
  immediately and being deleted. Keep each token and unexchanged code bound to
  the consent that authorized it, so deleting the consent deletes its tokens
  and voids its codes (the oauth-provider patch and the `consent_id`
  cascade), and keep the Connected assistants section name in step with the
  copy. Tokens issued before the
  binding reference no consent and never work again for a client that asks
  for consent, so they can't outlive a disconnect; the assistant connects
  once more. Never bind existing tokens to a consent after the fact.
- Account deletion expires the Dotypos profile and removes the live login
  account. Don't promise automatic Dotypos deletion after any period: the
  Dotypos Customer API documents no retention or anonymization behavior for
  `expireDate`. Never delete or anonymize the Dotypos customer or its
  reservation, payment, invoice, or legal records.
- In privacy copy, name recipients by category (Dotypos is the one provider
  named) and state transfers outside the EU in general terms, in §7 of the
  notice: the countries, the type of safeguard (adequacy, including the DPF,
  or SCCs; Art. 49(1)(b) for the door-lock provider), and how to get a copy.
  A customer's AI assistant provider is a recipient the customer chose, so its
  possible location outside the EU is stated in §6 beside that recipient, not
  in §7.
  Provider names, regions, retention, and safeguards stay in the tables above.
- Whenever a provider, plan, or region changes, update the transfers table and
  check that §7 still holds. For example, a new country without an adequacy
  decision or SCCs would make "we use only…" false.
- Don't mirror Resend message bodies or delivery events into Workspace.
- Neon preview branches copy production data at the branch point, and later
  production deletions don't reach existing branches. The allowed contents,
  including `auth.passkey` rows and their customer-written labels, and the
  no-sanitizer rule are in the root `AGENTS.md`. Rely on the
  integration's preview-branch cleanup; don't add a scrub job, PII-free
  parent, branch reset job, or masking branch. Never query, log, display, or
  email inherited real identities during E2E.
- Because preview-branch cleanup is the retention control, check the Neon
  integration as an operations task: the production branch is protected,
  automatic cleanup of obsolete preview branches is on, and neither setting has
  drifted.
- Avatars never enter Neon. See [avatar media storage](avatar-media-storage.md).
- PostHog has its own retention and erasure limits. See
  [PostHog identity and privacy](posthog-identity-privacy.md).
- The privacy policy discloses the consent-free reservation and payment step
  records in section 3, their agent fields in section 2, and their
  legitimate-interest basis and the right to object in section 4. Keep those lines in sync with the lifecycle event
  contract in
  [PostHog identity and privacy](posthog-identity-privacy.md#reservation-and-payment-lifecycle-events):
  a payload change that sends a new kind of data changes the notice too.

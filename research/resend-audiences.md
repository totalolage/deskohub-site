# Resend audiences vs our own audiences for admin email campaigns

**Sources accessed:** 2026-10-14. Resend docs pages do not show a last-updated date, so each docs claim is "as read on 2026-10-14". Changelog, blog, legal, and GitHub dates are the publication dates those pages state.

**Question:** The admin campaign feature defines an audience as a named set of filters over our Postgres data, a template (the email chrome), and a WYSIWYG body. Can Resend's audience features carry any of that, or should we keep audiences in our DB and send through Resend's email/batch API?

**Labels:** **Fact** = stated by the cited primary source. **Inference** = our reading, not stated by Resend.

## 1. Resend's current contact model

- **Fact.** Contacts are global and keyed by email address: "Contacts are global entities linked to a specific email address." ([Contacts introduction](https://resend.com/docs/dashboard/contacts/introduction))
- **Fact.** On 2025-11-05 Resend "renamed Audiences to Segments" and made Contacts global, counted once across Segments. ([New Contacts experience, blog 2025-11-05](https://resend.com/blog/new-contacts-experience))
- **Fact.** The Audiences API is deprecated: "These endpoints still work, but will be removed in the future." No removal date is given. ([Create Audience, legacy](https://resend.com/docs/api-reference/audiences/create-audience), [migration guide](https://resend.com/docs/dashboard/contacts/migrating-from-audiences-to-segments))
- **Fact.** The current building blocks are:
  - **Segments:** internal groupings for Broadcasts, not visible to recipients ([Managing Segments](https://resend.com/docs/dashboard/contacts/manage-segments)).
  - **Topics:** recipient-facing preference categories with a default of `opt_in` or `opt_out` that cannot change after creation ([Create Topic](https://resend.com/docs/api-reference/topics/create-topic), [Why use Topics](https://resend.com/docs/knowledge-base/why-use-topics)).
  - **Contact Properties:** custom fields with keys of up to 50 alphanumeric or underscore characters, type `string` or `number`, and an optional fallback ([Create Contact Property](https://resend.com/docs/api-reference/contact-properties/create-contact-property)). Contact update and CSV import also accept boolean values ([Update Contact](https://resend.com/docs/api-reference/contacts/update-contact)), and no source reconciles this with the create-property types.
  - **Broadcasts:** marketing sends to a Segment ([Create Broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast)).
- **Fact.** `resend-node` v6.33.0 (tagged 2026-10-14) exposes `contacts`, `segments`, `topics`, and `contactProperties`. `audiences` remains as a deprecated alias of `segments`. These namespaces first appear in v6.4.0 (2025-10-31), so our installed `resend@6.32.1` already has them. ([v6.33.0 `src/resend.ts`](https://github.com/resend/resend-node/blob/v6.33.0/src/resend.ts), [v6.4.0 `src/resend.ts`](https://github.com/resend/resend-node/blob/v6.4.0/src/resend.ts))

### Segments are explicit membership, not filters

- **Fact.** `POST /segments` takes only `name`, and the endpoint is described as "Create a new segment for contacts to be added to." ([Create Segment](https://resend.com/docs/api-reference/segments/create-segment), re-read directly on 2026-10-14)
- **Fact.** Membership changes one contact at a time with `POST` and `DELETE /contacts/:contact_id/segments/:segment_id` ([Add Contact to Segment](https://resend.com/docs/api-reference/contacts/add-contact-to-segment)). The dashboard flow is also "Enter a name", then add or remove contacts ([Managing Segments](https://resend.com/docs/dashboard/contacts/manage-segments)). The dashboard can bulk add or remove contacts ([Bulk actions changelog, 2026-01-15](https://resend.com/changelog/bulk-actions)).
- **Fact (absence).** Rule-based or dynamic segments over contact properties are documented neither in the API nor in the dashboard (searched: Create Segment, Managing Segments, Contacts introduction).
- **Inference.** Resend cannot store or evaluate our audience definitions. Our filters (consent, reservation history, and so on) would always have to run in our DB, and a Resend Segment could only be a materialized snapshot of the result.

## 2. Broadcasts

- **Fact.** `POST /broadcasts` requires `from` and `subject` plus content (`html`, `text`, or `react`), and accepts `segment_id`, `name`, `reply_to`, `topic_id`, `send`, and `scheduled_at`. With `send: true` the broadcast is sent or scheduled "without requiring a separate call". The endpoints `POST /broadcasts/:id/send`, `PATCH`, `DELETE` (unsent only), `GET`, and list also exist. ([Create Broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast), [Send](https://resend.com/docs/api-reference/broadcasts/send-broadcast), [Delete](https://resend.com/docs/api-reference/broadcasts/delete-broadcast), [Node interface](https://github.com/resend/resend-node/blob/canary/src/broadcasts/interfaces/create-broadcast-options.interface.ts))
- **Fact.** No idempotency option is documented for Broadcasts. Idempotency keys cover Send Email and Send Email Batch only. ([Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys))
- **Fact.** Resend handles unsubscribes for Broadcasts "once you include `{{{RESEND_UNSUBSCRIBE_URL}}}`" ([Should I add an unsubscribe link](https://resend.com/docs/knowledge-base/should-i-add-an-unsubscribe-link)). The docs neither say Resend inserts the placeholder automatically nor that it rejects HTML without it. A 2024 blog says `List-Unsubscribe` and `List-Unsubscribe-Post` are "handled automatically when using Resend Broadcasts" ([blog, 2024-01-09](https://resend.com/blog/gmail-and-yahoo-bulk-sending-requirements-for-2024)).
- **Fact.** A contact with `unsubscribed: true` "will not receive Broadcasts or Automation emails, even if they are subscribed to individual Topics" ([Managing unsubscribed Contacts](https://resend.com/docs/dashboard/contacts/managing-unsubscribe-list)). Team-wide suppressions (hard bounce, complaint, manual) apply to both Broadcasts and transactional sends ([Email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)).
- **Fact.** Contact-property placeholders with fallbacks work in Broadcasts, for example `{{{contact.first_name|there}}}` ([Create Broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast), [Contact properties](https://resend.com/docs/dashboard/contacts/properties)).
- **Fact.** Analytics:
  - `GET /broadcasts/:id/recipients?type=opened|clicked|bounced` lists recipients per event ([List broadcast recipients](https://resend.com/docs/api-reference/broadcasts/list-broadcast-recipients)).
  - The Email Metrics API filters by up to 100 broadcast IDs ([Email Metrics API](https://resend.com/docs/api-reference/emails/get-metrics), [changelog 2026-08-27](https://resend.com/changelog/email-metrics-api)).
  - `email.opened` and `email.bounced` webhook payloads carry `broadcast_id` ([email.opened](https://resend.com/docs/webhooks/emails/opened)).
  - Open and click tracking are per domain and "disabled by default for all domains" ([Tracking](https://resend.com/docs/dashboard/domains/tracking)).
- **Fact.** No per-segment or per-broadcast size cap and no numeric broadcast send rate is documented. Resend says it handles "queuing, throttling, and scheduling" ([Sending Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction)).
- **Fact.** API-created broadcasts "can be reviewed in the no-code editor before sending" ([Broadcast API blog, 2025-03-26](https://resend.com/blog/broadcast-api)).

## 3. Batch email API (the alternative)

- **Fact.** `POST /emails/batch` accepts up to 100 emails per call, with up to 50 `to` addresses per email. Attachments are not supported. `headers`, `tags`, `template`, and `topic_id` are supported per email. ([Batch sending](https://resend.com/docs/dashboard/emails/batch-sending), [Send batch API](https://resend.com/docs/api-reference/emails/send-batch-emails))
- **Fact.** Per-email `scheduledAt` works in batch per the scheduling guide and SDK v6.18.0, but the batch API reference omits the field ([Schedule email](https://resend.com/docs/dashboard/emails/schedule-email), [SDK CHANGELOG](https://github.com/resend/resend-node/blob/main/CHANGELOG.md)). Scheduling is out of scope here anyway.
- **Fact.** The SDK exposes `batchValidation: 'strict' | 'permissive'` and sends it as the `x-batch-validation` header. The public endpoint docs do not mention it and say an invalid email fails the whole request. ([SDK batch options v6.33.0](https://github.com/resend/resend-node/blob/v6.33.0/src/batch/interfaces/create-batch-options.interface.ts))
- **Fact.** An `Idempotency-Key` on a batch request covers the whole batch. Keys last 24 hours and may be up to 256 characters. ([Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [Batch idempotency changelog, 2025-06-05](https://resend.com/changelog/batch-idempotency-keys))
- **Fact.** The rate limit is 10 requests/second per team, shared across API keys. A batch call counts as one request. Exceeding the limit returns 429 with `ratelimit-*` and `retry-after` headers. Support can raise the limit. ([Usage limits](https://resend.com/docs/api-reference/rate-limit))
- **Fact.** The `topic_id` field on `/emails` and `/emails/batch` works per recipient:
  - Opted in: the email is sent.
  - Opted out: the email "is not sent and will be marked as failed".
  - Not a contact: the email is sent only if the topic default is opt-in.

  ([Send batch API](https://resend.com/docs/api-reference/emails/send-batch-emails), [Send email API](https://resend.com/docs/api-reference/emails/send-email)) A contact's global `unsubscribed` flag does not block `/emails` sends unless the request includes a `topic_id` the contact opted out of ([Managing unsubscribed Contacts](https://resend.com/docs/dashboard/contacts/managing-unsubscribe-list)).
- **Fact.** For `/emails` and batch, Resend does not manage the list. The sender adds a `List-Unsubscribe` header (and `List-Unsubscribe-Post` for bulk) and a visible link ([Add unsubscribe to transactional emails](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails), [Pricing FAQ](https://resend.com/pricing)). Team suppressions still apply ([Email suppressions](https://resend.com/docs/dashboard/emails/email-suppressions)).
- **Fact.** Batch sends produce the per-email webhooks `email.sent`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `failed`, `scheduled`, and `suppressed`. Up to 75 tags per email are echoed in webhook payloads. ([Event types](https://resend.com/docs/webhooks/event-types), [Tags](https://resend.com/docs/dashboard/emails/tags))
- **Fact.** The batch guide says: "For marketing campaigns, use our no-code editor, Broadcasts, instead." ([Batch sending](https://resend.com/docs/dashboard/emails/batch-sending)) The pricing FAQ nonetheless says "A newsletter can be sent through the /emails API" ([Pricing](https://resend.com/pricing)). The Acceptable Use Policy (updated 2026-10-13) requires explicit opt-in and a frictionless opt-out honored within seven days, and names no endpoint ([AUP](https://resend.com/legal/acceptable-use)).
- **Inference.** Sending campaigns through batch is allowed. Resend steers marketing toward Broadcasts mainly through pricing and product positioning, not through a rule.

## 4. Contact sync

- **Fact.** The contact endpoints are:
  - `POST /contacts`: email plus optional names, `unsubscribed`, properties, segments, and topics.
  - `PATCH /contacts/:id_or_email`: `null` clears a property.
  - `GET` and `DELETE` by id or email.
  - `GET /contacts`: cursor-paginated with `limit` 1–100, `after`/`before`, and an optional `segment_id` filter.

  ([Create](https://resend.com/docs/api-reference/contacts/create-contact), [Update](https://resend.com/docs/api-reference/contacts/update-contact), [List](https://resend.com/docs/api-reference/contacts/list-contacts))
- **Fact.** `GET` and `PATCH /contacts/:id/topics` read and set `opt_in`/`opt_out` per topic ([Update Contact Topics](https://resend.com/docs/api-reference/contacts/update-contact-topics)).
- **Fact.** There is no bulk JSON contact upsert. Bulk sync uses `POST /contacts/imports` with a multipart CSV of up to 200 MB, `on_conflict: upsert | skip`, asynchronous processing, and automatic creation of missing properties ([Create Contact Import](https://resend.com/docs/api-reference/contacts/create-contact-import), [CSV import changelog, 2026-06-24](https://resend.com/changelog/csv-contacts-import)). Contacts created by CSV import do not fire `contact.created` ([contact.created](https://resend.com/docs/webhooks/contacts/created)).
- **Fact.** Webhooks exist for `contact.created`, `contact.updated`, `contact.deleted`, and `contact.topics.updated`, signed with Svix headers ([Event types](https://resend.com/docs/webhooks/event-types), [contact.topics.updated](https://resend.com/docs/webhooks/contacts/topics-updated), [Verify webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)). A 2024 changelog tells users to listen for `contact.updated` when a contact unsubscribes ([New contact webhooks, 2024-07-17](https://resend.com/changelog/new-contact-webhooks)).
- **Inference.** A global unsubscribe on Resend's hosted page fires `contact.updated` with `unsubscribed: true`, and a topic change fires `contact.topics.updated`. Both would have to be written back to `customer_marketing_consents`.
- **Inference.** At 10 req/s, adding contacts to a segment one call at a time takes about 100 s per 1,000 recipients, before any upserts.

## 5. Templates and editor

- **Fact.** The Templates API was announced 2025-11-04. Templates support `POST /templates`, versioning, required publishing before use, and up to 50 string or number variables with fallbacks. ([Introducing Templates](https://resend.com/blog/introducing-templates), [Create Template](https://resend.com/docs/api-reference/templates/create-template))
- **Fact.** `/emails/batch` items can pass `template: { id, variables }`, which cannot be combined with `html`, `text`, or `react` ([Send batch API](https://resend.com/docs/api-reference/emails/send-batch-emails)).
- **Fact (absence).** Create Broadcast has no `template` field, and the docs do not show using a Template in a Broadcast ([Create Broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast)).
- **Fact.** A rebuilt visual editor shipped across Templates, Broadcasts, and Unsubscribe Pages on 2026-03-12 ([New email editor](https://resend.com/changelog/introducing-the-new-email-editor)). It is a dashboard editor, and no embeddable component or SDK is documented ([Broadcast editor](https://resend.com/docs/dashboard/broadcasts/editor)).
- **Fact.** The docs disagree on the reserved unsubscribe variable name: `RESEND_UNSUBSCRIBE_URL` in Create Template and Broadcasts, `UNSUBSCRIBE_URL` in the batch template reference ([Create Template](https://resend.com/docs/api-reference/templates/create-template), [Send batch API](https://resend.com/docs/api-reference/emails/send-batch-emails)).
- **Inference.** Resend cannot replace our in-app WYSIWYG, because admins would have to compose in Resend's dashboard. Templates could hold the chrome, but our CLI and UI would then edit HTML stored at Resend, outside our repo and tests. Rendering the chrome ourselves (React Email, as the app does today) and sending `html` is simpler.

## 6. EU and compliance

- **Fact.** No built-in double opt-in setting exists. Resend's examples index links double-opt-in example flows only ([Examples](https://resend.com/docs/examples)).
- **Fact.** The hosted unsubscribe and preference page can be branded with title, description, logo, and colors. Pro removes "Powered by Resend". Language or localization controls are not documented. ([Custom unsubscribe page](https://resend.com/docs/dashboard/settings/unsubscribe-page))
- **Fact.** Domains can send from Ireland (`eu-west-1`), but "account data, metadata, logs" stay in the US ([Choosing a region](https://resend.com/docs/dashboard/domains/regions)).
- **Inference.** A hosted page with no documented localization is a risk for Czech-language recipients.

## 7. Pricing

- **Fact.** Transactional plans are billed by emails sent: Free $0 for 3,000/month and 100/day, Pro $20 for 50,000/month, and Scale from $90 for 100,000/month. Overage is $0.90 per 1,000 on Pro. ([Pricing KB](https://resend.com/docs/knowledge-base/what-is-resend-pricing), re-read 2026-10-14; [Pricing](https://resend.com/pricing))
- **Fact.** Marketing plans are billed "based on the number of contacts, not the number of emails sent". Free covers 1,000 contacts. Pro Marketing costs $40 for 5,000, $80 for 10,000, $120 for 15,000, $180 for 25,000, $250 for 50,000, $450 for 100,000, and $650 for 150,000 contacts. "Broadcasts can only be sent to existing contacts." ([Pricing KB](https://resend.com/docs/knowledge-base/what-is-resend-pricing))
- **Fact.** "Only emails sent through the /emails API count towards your transactional email limits". Over the contact quota, "you won't be able to send broadcasts until you upgrade your plan or remove contacts" ([Pricing](https://resend.com/pricing), [Usage limits](https://resend.com/docs/api-reference/rate-limit)).
- **Fact (absence).** The docs do not say how a team with both plans is invoiced. Prices are shown in `$` only.
- **Inference.** Broadcasts add a second, contact-based plan next to our transactional plan. Every synced contact counts toward the quota, whether or not it receives anything.

## 8. Our repository today (read 2026-10-14, base `65d45d379`)

- All sends go through the shared single-email provider `packages/email/backend/providers/resend-provider.ts:56-99`, which calls `resend.emails.send` with tags and an idempotency key. No production batch call exists.
- The webhook `apps/deskohub-workspace/app/api/webhooks/resend/route.ts` → `resend-webhook.service.ts:195-202` handles only `email.delivered`, `email.failed`, and `email.bounced`, for reservation delivery.
- Consent lives in `customer_marketing_consents`, keyed by `dotyposCustomerId` with `locale`, `grantedAt`, and `withdrawnAt` (`apps/deskohub-workspace/db/schema/customer-marketing-consents.ts:11-39`). `customer_marketing_management_tokens` backs our own preference-management links (`customer-marketing-management-tokens.ts:8-34`).
- The lockfile resolves `resend@6.32.1` (`bun.lock:2624`).
- **Inference.** We already own the consent record and a preference-management flow. Resend's unsubscribe state would duplicate that source of truth.
- **Inference.** Consent is keyed by Dotypos customer ID, so recipient email resolution may go through Dotypos profile data. This is not verified here.
- **Inference.** AGENTS.md forbids real PII in preview environments. Contacts are team-wide in Resend, so any contact sync must be off, or use a separate Resend team, outside production.

## 9. Options

| | (A) Our-DB audiences + batch send | (B) Sync contacts + Resend segments/broadcasts | (C) Hybrid: our filters → segment snapshot → broadcast |
|---|---|---|---|
| Audience filters | Ours, evaluated at send time | Not possible in Resend (explicit membership only); the filters stay ours anyway | Ours, materialized into a fresh Segment per campaign |
| Unsubscribe / List-Unsubscribe | We build: headers + link to our existing preference page | Resend-hosted, automatic | Resend-hosted, automatic |
| Consent source of truth | Single (our DB) | Two; needs a `contact.updated` / `contact.topics.updated` write-back webhook | Two; same write-back |
| Suppression of bounces/complaints | Resend team suppressions apply | Same | Same |
| Idempotency | Per-batch `Idempotency-Key` (24 h) | None documented for broadcasts | None documented; snapshot + send must be made retry-safe by us |
| Analytics | Per-email webhooks with our tags; we store them | Resend recipients/metrics APIs + webhooks with `broadcast_id` | Same as B |
| Throughput at 10 req/s | 1,000 emails/s ceiling (100/call) | Contact sync: about 1 call per contact; broadcast send is 1 call | Per-campaign membership writes ≈ 1 call per recipient |
| Templates / WYSIWYG | Ours (React Email chrome + our editor) | Ours; Resend editor is dashboard-only | Ours |
| Cost | Transactional quota: each campaign email counts | Adds a Marketing plan priced per synced contact; sends unlimited | Same as B |
| Czech hosted pages | Ours, already localized | Localization undocumented | Localization undocumented |
| Hard blockers | None found | No dynamic segments; preview-PII rule | Same as B, plus no broadcast idempotency |

**Recommendation (inference):** Take option A, sending through `/emails/batch` with an idempotency key per batch. Put our tags on each email so webhooks map back to campaigns. Add `List-Unsubscribe` / `List-Unsubscribe-Post` headers that point at our existing marketing-management flow, and filter on `customer_marketing_consents.withdrawnAt` at send time.

Revisit C only if cheap Resend-side analytics or the hosted unsubscribe page start to matter more than a single consent store. Even then, Resend's dynamic-segment gap means our DB stays the audience engine.

Optional: pass a Resend `topic_id` on batch sends as a second guard. That only works if contacts and topic state are synced to Resend, so it reintroduces B's sync cost.

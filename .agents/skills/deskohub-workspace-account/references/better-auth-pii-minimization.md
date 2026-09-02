# Better Auth data minimization in Neon

Research snapshot: 2026-09-02. This note checks Better Auth 1.7.2, pinned at
commit [`ba12fcd`](https://github.com/better-auth/better-auth/tree/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2).
It focuses on the email and IP addresses that a magic-link deployment can put
in Neon. Names, phone numbers, billing details, and reservations remain in
Dotypos.

## Result

With Better Auth's database-backed sessions and rate limiter, Neon needs to
contain:

- one normalized login email per live user;
- the same email in each pending magic-link verification row until that link is
  used or the row is cleaned up; and
- a normalized IP address plus auth route in each live database rate-limit key.

The session table does not need an IP address or user agent. A native Better
Auth database hook can replace both values with `null` when it creates a
session while leaving IP detection enabled for rate limiting.

This is the smallest change that preserves the agreed design. Accept the
remaining email and short-lived rate-limit IP rows in Neon branches under the
same project access controls and branch lifetime. Do not add branch scrubbing,
a second datastore, or custom authentication storage just to remove them.

## Field-by-field contract

| Record | Stored value | Minimum configuration | Reason and tradeoff |
| --- | --- | --- | --- |
| `auth.user` | Raw, lower-cased email | Keep. Do not pass a name to the magic-link request, so the required Better Auth `name` is the empty string. Leave `image` null. Keep email changes disabled. | Better Auth's user schema requires a unique email, and returning magic-link sign-in looks the user up by lower-cased email. Better Auth has no native email hashing or encryption option. A hash cannot supply the verified address to the application, and transparent encryption would require a custom adapter. |
| `auth.session` | Opaque session token, user ID, expiry and timestamps | Add `databaseHooks.session.create.before` that returns the session with `ipAddress: null` and `userAgent: null`. Do not enable `preserveSessionInDatabase`. | The core schema marks IP and user agent optional. Better Auth fills them during session creation, then runs its native create hook before the adapter insert. Session refresh updates expiry and timestamp only, so the fields stay null. The token remains a bearer credential. Better Auth has no native session-token hashing option. |
| `auth.verification` | Hash of the magic-link token; JSON value containing raw email; expiry and timestamps | Set exactly one built-in hashing option: `magicLink({ storeToken: "hashed" })` or global `verification.storeIdentifier: "hashed"`. Prefer the plugin option because this deployment only uses magic links. Omit `name` and `metadata`. Keep the approved 10-minute expiry and daily expired-row cleanup. | Better Auth must recover the email after the link is clicked, before it creates or finds the user. Its magic-link value is fixed JSON containing email and optional name. There is no native value-encryption hook on reads. The identifier can and should be hashed. A used token is consumed atomically; an unused expired row needs cleanup. |
| `auth.rate_limit` | Raw normalized `IP|path`, count and last-request time | Keep database storage and trusted Vercel IP resolution. Keep windows no longer than the approved abuse controls require. Run the existing daily cleanup contract. | Better Auth derives one IP for both session tracking and rate limiting. Database storage writes the raw key and has no native hash option. IPv6 is masked to `/64` by default; IPv4 stays whole. The built-in request-driven sweep does not guarantee prompt deletion of a key that receives no later request. |
| `auth.account` | No rows for the magic-link-only flow | Leave the required core table empty. Do not enable passwords, OAuth, or social providers. | The magic-link verifier creates a user and session directly. It does not create an account row. Better Auth still includes the core account table in its generated database schema. |
| `public.customer_account_links` | Better Auth user ID and Dotypos customer ID | Keep only the two opaque IDs and workflow state already approved. | No email, IP, profile field, or reservation fact is duplicated here. |

Primary evidence:

- Better Auth documents email as the unique login field and marks session IP
  and user agent optional in its
  [core database schema](https://better-auth.com/docs/concepts/database#core-schema).
- The pinned source defines required user email, optional session IP and user
  agent, and the always-present account table in
  [`get-tables.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/core/src/db/get-tables.ts#L130-L271).
- The magic-link plugin writes `{ email, name }`, consumes that row, finds the
  user by email, and creates a blank name when none was supplied in
  [`magic-link/index.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/plugins/magic-link/index.ts#L235-L431).
- Better Auth documents the native plain or hashed magic-link token storage
  choices in its
  [magic-link options](https://better-auth.com/docs/plugins/magic-link#configuration-options).
- Session creation derives IP and user agent before invoking `createWithHooks`
  in
  [`internal-adapter.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/db/internal-adapter.ts#L467-L578).
  The hook merges returned values over the pending insert in
  [`with-hooks.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/db/with-hooks.ts#L29-L84).

The minimum session hook is:

```ts
databaseHooks: {
  session: {
    create: {
      before: async (session) => ({
        data: { ...session, ipAddress: null, userAgent: null },
      }),
    },
  },
},
```

Test one real magic-link verification against migrated Postgres and assert the
created session row has null IP and user-agent fields. That protects the
minimization rule from a Better Auth upgrade.

## Why the remaining email cannot use a native transform

Magic-link submission must accept the raw address so the application can send
the link. Verification then needs the same address to find an existing user or
create a new one. The pinned adapter lower-cases the email on create and uses
an exact lower-cased lookup in
[`internal-adapter.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/db/internal-adapter.ts#L276-L310)
and
[`internal-adapter.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/db/internal-adapter.ts#L1000-L1031).

Database hooks cover creates, updates, and deletes. They do not transform
queries or decrypt rows. Better Auth documents field-name mapping but no
at-rest transform for user email in its
[user options](https://better-auth.com/docs/reference/options#user).
Hashing or encrypting the user email would therefore mean wrapping or replacing
the database adapter, managing a separate lookup digest, and handling key
rotation. That is a custom identity store, not a configuration change.

The pending verification email has the same constraint. Better Auth parses the
stored JSON directly after consuming it. The native `storeToken` and
`verification.storeIdentifier` options transform only the identifier, not the
JSON value. Do not configure both hash options. Double hashing works because
both write and read apply both transforms, but it adds no protection.

## Rate-limit choices

Better Auth uses the resolved IP for two independent jobs. Session creation
stores it on the session row, while the rate limiter builds
`normalized-IP|route`. The pinned implementation is in
[`ip.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/core/src/utils/ip.ts#L346-L396)
and
[`rate-limiter/index.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/api/rate-limiter/index.ts#L331-L400).
This is why the session hook is preferable to `disableIpTracking`.

The alternatives are worse for this application:

| Choice | Effect | Decision |
| --- | --- | --- |
| `advanced.ipAddress.disableIpTracking: true` | The pinned rate limiter returns without consuming any limit. This disables the magic-link abuse control as well as session IP capture. Better Auth's option type labels this a security risk. | Reject. |
| Deliberately provide no trusted IP header | Better Auth stores a constant `no-trusted-ip|path` key. Every visitor shares the same small bucket, so one client can block sign-in for everyone. | Reject. |
| In-memory rate limiting | Stores no IP in Neon, but each serverless instance has a separate counter and cold starts reset it. Better Auth itself says memory may not suit serverless deployments. | Reject. |
| Secondary storage | Moves the raw IP keys elsewhere with a native Better Auth option. It adds another service, credentials, preview wiring, and failure mode. | Reject under the existing-database decision. |
| Vercel or another edge rate limiter | Keeps IP handling out of the application database. It moves an authentication control into deployment configuration and requires separate verification for production and previews. | Defer unless a platform rule already exists and is included in the current plan. |
| HMAC the key through `rateLimit.customStorage` | Preserves per-IP grouping without reversible IP values in Neon. Better Auth passes the raw key to `customStorage.consume`, so the implementation can HMAC it before storage. | Do not add now. It replaces Better Auth's tested atomic database implementation with security-sensitive custom SQL and key-rotation behavior solely to remove a value kept for minutes. |

Better Auth documents database, memory, secondary, and custom stores in its
[rate-limit guide](https://better-auth.com/docs/concepts/rate-limit#storage).
The custom contract requires one atomic `consume` operation. The pinned
database implementation contains conflict handling and guarded increments in
[`rate-limiter/index.ts`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/api/rate-limiter/index.ts#L89-L227).
Copying that logic for HMAC storage would create more risk than it removes.

## Retention and branch impact

The approved deterministic cleanup remains appropriate:

- delete expired session rows daily;
- delete expired verification rows daily; and
- delete rate-limit rows older than the longest configured window daily.

Better Auth deletes a verification row when the link is consumed. A lookup can
sweep expired verification rows, but the magic-link consume path does not sweep
unrelated rows. The database rate limiter sweeps old rows only when an existing
key crosses into a new window. Those request-driven paths do not give an upper
bound for abandoned rows. See the pinned
[`verification adapter`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/db/internal-adapter.ts#L1235-L1435)
and
[`database rate limiter`](https://github.com/better-auth/better-auth/blob/ba12fcdfa774ca27d417079dbac0b1b5894ccaf2/packages/better-auth/src/api/rate-limiter/index.ts#L89-L244).

A Neon branch made from production can therefore contain:

- every live account email at the branch point;
- pending verification emails that existed at that moment; and
- recent rate-limit IP keys that existed at that moment.

Later deletion or cleanup on production does not alter an existing branch.
That fact does not justify a new scrub-on-branch procedure by itself. The
lowest-risk plan is to minimize session data as above, rely on the existing
branch access and expiry controls, and state plainly that protected Neon
branches may contain the same limited authentication data as their parent.
If policy cannot permit that, the next-smallest technical choice is HMAC rate
keys, but user emails still require either protected branch copies or a custom
identity adapter. There is no Better Auth switch that makes a production clone
email-free.

# `dhw`

`dhw` is the native Deskohub Workspace administration CLI. Its commands use
the same Effect HTTP API contract and application services as the `/admin`
interface.

The CLI includes a typed `/api/v1/cli` Effect HTTP client, browser-approved
authentication, OS credential-store integration, release automation, and
self-updates. Administrative resource commands are added incrementally while
sharing their application services with `/admin`.

## Authentication

Run `dhw auth`. The command creates a five-minute authentication request and
prints an `/admin/cli/authenticate` URL. After an administrator approves that
request behind the existing `/admin` Basic authentication, the CLI exchanges a
single-use grant bound to its local verifier and stores the resulting opaque
bearer in macOS Keychain or the Linux Secret Service.

Permanent bearer values are never stored by the server; only their SHA-256
digests are persisted. `/admin/cli/sessions` lists issued sessions and revokes
them. Every authenticated CLI operation validates its session, and a revoked
credential is removed from secure storage as soon as the API reports it.

The public authentication-start endpoint is fail-closed behind the Vercel
Firewall Rate Limiting SDK. The Workspace Vercel project must define an
`@vercel/firewall` rate limit with the ID `cli-authentication-start`, allowing
10 requests per IP per minute and returning 429 after the limit.

## Development

```bash
bun --cwd apps/dhw typecheck
bun --cwd apps/dhw test
bun apps/dhw/src/main.ts --help
bun apps/dhw/src/build.ts development
apps/dhw/dist/dhw version --json
```

The release build target is explicit and embedded in the binary. The supported
targets are:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64-baseline`

Windows is intentionally unsupported. Asset selection never infers a target
from the host OS, architecture, or `uname`; the updater uses only the build
target embedded at compilation.

Non-release binaries identify their provenance in SemVer build metadata.
Development builds use `<version>+development`, and PR artifacts use
`<version>+pr.<number>.<head-sha>`. Published releases keep the plain package
version.

## Configuration

- `DHW_BASE` changes the Workspace origin. It must be HTTPS, except for HTTP on
  localhost during development.
- `DHW_REQUEST_HEADERS` is a JSON object of additional API request headers. It
  is intended for preview-protection bypass headers and its values are redacted
  by Effect. It is never sent to GitHub during update checks.
- `DHW_STATE_DIR` overrides the local updater state directory.
- `DHW_NO_UPDATE_CHECK=true` disables automatic checks.

For a protected Vercel preview, configuration can be scoped to one invocation:

```bash
DHW_BASE=https://example-git-branch-team.vercel.app \
  DHW_REQUEST_HEADERS='{"x-vercel-protection-bypass":"…"}' \
  dhw auth
```

Automatic update checks run only for interactive commands, never for JSON
output, CI, or redirected input/output. The last attempt and GitHub ETag are
persisted, and another request is not made for 30 seconds. `dhw update` forces a
check. An update is accepted only from a stable immutable `dhw-v*` release with
the exact embedded target, expected size, GitHub SHA-256 digest, and matching
binary-reported version and target.

## Automatic releases

Release Please owns `apps/dhw/package.json`, `apps/dhw/CHANGELOG.md`, and the
`dhw-v*` tags. A pull request that changes the CLI or its shared API contract
must contain at least one releasable Conventional Commit:

- `feat(dhw): ...` for a minor release
- `fix(dhw): ...` for a patch release

Because Release Please scopes the `dhw` component to `apps/dhw`, a shared
contract change under `packages/workspace-admin-api` must also include its
corresponding CLI change under `apps/dhw`. CI rejects contract-only changes so
the Workspace endpoint cannot advance without a versioned CLI counterpart.

When such a pull request is merged into `main`, the release workflow updates a
transient Release Please pull request and enables auto-merge on it. Once its
required checks pass, the workflow creates a draft release, builds and attests
all four binaries on native runners, uploads them together with `SHA256SUMS`,
and publishes the release. There is no per-release manual merge or publish
step.

Repository setup requires a GitHub App installed on this repository with
Contents and Pull requests read/write, Issues read/write, and Administration
read permissions. Set its app ID as the `DHW_RELEASE_APP_ID` Actions variable
and its private key as the `DHW_RELEASE_APP_PRIVATE_KEY` Actions secret. Enable
auto-merge, allow merge commits, and enable immutable releases for the
repository. The workflow fails closed if immutable releases are not enabled.

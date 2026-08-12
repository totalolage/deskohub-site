---
name: deskohub-dotypos
description: Dotypos API, OpenAPI contract, generated client, authorization, and diagnostic handling.
---

# Deskohub Dotypos

Read only the reference relevant to the change:

- For the package boundary and client generation, read [references/openapi.md](references/openapi.md).
- For Connector authorization and refresh-token acquisition, read [references/authorization.md](references/authorization.md).
- For bounded manual API inspection, read [references/manual-diagnostics.md](references/manual-diagnostics.md) and the Workspace production-diagnostics reference before accessing production.

For a Dotypos resource or item operation:

1. Consult the official API documentation.
2. Send an authenticated `OPTIONS` request to the resource or item URL to verify supported operations. Never print the credentials.
3. Verify the live response shape.
4. Model the endpoint in the Dotypos OpenAPI specification.
5. Regenerate the client and use the generated contract.

Do not add a parallel hand-written response decoder when the contract can be generated.

Customer-facing Workspace app builds must load Dotypos-backed catalog data through the Workspace backend. Keep fixtures in test or screenshot tooling only; never ship an installable runtime switch that substitutes a mock menu, authentication, or payment flow.

Cache the customer browsing projection server-side to limit Dotypos reads, but always reload Dotypos authoritatively for quotes and order affirmation. Preserve the provider snapshot time through browsing caches so clients never display a request-time timestamp for stale catalog data.

For production log inspection or provider diagnostics, also read `../deskohub-workspace-operations/references/diagnostics.md` before fetching data.

Update this skill when developer feedback changes the integration workflow.

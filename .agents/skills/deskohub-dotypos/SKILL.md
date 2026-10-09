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

## Customer records

- Dotypos filters customer `email` only through the STRING group: `email|like|value` is a case-insensitive substring match (`ILIKE '%value%'`, see the official filter and Customer entity references). Treat its results as candidates and identify a customer only by a whole-address, case-insensitive email comparison. Customers that differ only by email case are ambiguous, never silently merged.
- Store the email as the customer entered it; lookups, not writes, carry the case-insensitivity.
- An absent or unparseable phone must never overwrite the stored Dotypos phone. Omit the field from update patches. Only an explicit, validated clearing path such as the customer's own account profile edit sends the blank value.

For production log inspection or provider diagnostics, also read `../deskohub-workspace-operations/references/diagnostics.md` before fetching data.

Update this skill when developer feedback changes the integration workflow.

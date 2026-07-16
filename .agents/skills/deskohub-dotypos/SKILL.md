---
name: deskohub-dotypos
description: Research, add, or change Deskohub Dotypos API resources and operations by verifying official documentation and live capabilities, updating the OpenAPI contract, and regenerating the client.
---

# Deskohub Dotypos

For a Dotypos resource or item operation:

1. Consult the official API documentation.
2. Send an authenticated `OPTIONS` request to the resource or item URL to verify supported operations. Never print the credentials.
3. Verify the live response shape.
4. Model the endpoint in the Dotypos OpenAPI specification.
5. Regenerate the client and use the generated contract.

Do not add a parallel hand-written response decoder when the contract can be generated.

For production log inspection or provider diagnostics, also read `../deskohub-workspace-operations/references/diagnostics.md` before fetching data.

Update this skill when developer feedback changes the integration workflow.

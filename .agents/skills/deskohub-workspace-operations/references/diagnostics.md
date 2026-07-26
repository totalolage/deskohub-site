# Production diagnostics

## Use the logging pipeline

- Use `Effect.log*` inside the censored Workspace logging pipeline. Do not use `console.*` for Workspace diagnostics.
- Preserve useful safe log annotations, but never attach provider credentials, provider redirect URLs, raw database causes, or provider payloads. Global censorship is defense in depth, not authorization to send sensitive values to a sink; SQL bind parameters must remain opaque.
- Keep access-code-like keys globally censored. Workspace customer access codes have appeared in PostHog annotations before; never quote an observed value back to the user.

## Bound sensitive or oversized inspection

- Do not enable, fetch, or quote Dotypos request/response debug logging for production diagnostics without explicit redaction. It can contain Authorization headers, refresh tokens, bearer tokens, and token response bodies.
- Avoid fetching or quoting full raw Workspace Cloudinary search payloads. They can include large provider and asset metadata annotations. Prefer result count, public IDs, status, and error code.
- Avoid ad-hoc Workspace status or service scripts unless needed. They can print raw reservation annotations such as customer access codes; never quote those lines back to the user.

## Verify integration identity first

When an exact Cloudinary public ID returns 404, verify the full Cloudinary account tuple before changing image-rendering code. Credentials in sibling app environment files can target another product environment.

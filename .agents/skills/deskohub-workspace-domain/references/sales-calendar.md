# Sales calendar discounts

Model Workspace sales calendar events as references to stored discount definitions:

- Treat the visible event-description content as exactly one discount UUID. Accept either the raw UUID or Google Calendar's canonical `<p><code>UUID</code></p>` storage wrapper; reject every other rich-text structure or additional content.
- Let Calendar own occurrence timing.
- Let Postgres own the public label, adjustment, and product targets.
- Do not reintroduce TOML sale configuration.

# Sales calendar discounts

Model Workspace sales calendar events as references to stored discount definitions:

- Treat the trimmed event description as exactly one discount UUID.
- Let Calendar own occurrence timing.
- Let Postgres own the public label, adjustment, and product targets.
- Do not reintroduce TOML sale configuration.

# Dotypos OpenAPI Integration

## Overview

Dotypos integration is OpenAPI-first and layered:

1. OpenAPI schema (`features/dotypos/openapi/dotypos-api.yaml`)
2. Generated client/types (`features/dotypos/generated/*`)
3. Effect service layer (`features/dotypos/backend/service.ts`)
4. Consumption by feature actions/routes (`table-reservation`, reservation webhooks, menu reads)

## Directory Layout

```text
features/dotypos/
|- openapi/
|  |- dotypos-api.yaml
|  `- openapi-ts.config.ts
|- generated/
|- backend/
|- utils/
`- index.ts
```

## Code Generation

Regenerate Dotypos client code with:

```bash
bun run dotypos:generate
```

(`package.json` script currently runs `cd features/dotypos/openapi && bunx openapi-ts`.)

## Service Usage

Import from feature public API:

```ts
import { DotyposService } from "@/features/dotypos";
```

Provide the default layer where needed:

```ts
DotyposService.Default
```

## Required Environment Variables

- `DOTYPOS_CLIENT_ID`
- `DOTYPOS_CLIENT_SECRET`
- `DOTYPOS_REFRESH_TOKEN`
- `DOTYPOS_API_URL`
- `DOTYPOS_BRANCH_ID`
- `DOTYPOS_CLOUD_ID`
- `DOTYPOS_EMPLOYEE_ID`

All are validated in `env.ts`.

import { mock } from "bun:test";

mock.module("server-only", () => ({}));

const key = Buffer.alloc(32, 7).toString("base64url");

process.env.CHECKOUT_PAY_STATE_KEYS ??= `test:${key}`;
process.env.CLOUDINARY_API_KEY ??= "test";
process.env.CLOUDINARY_API_SECRET ??= "test";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.DOTYPOS_API_URL ??= "https://dotypos.example";
process.env.DOTYPOS_BRANCH_ID ??= "branch";
process.env.DOTYPOS_CLIENT_ID ??= "client";
process.env.DOTYPOS_CLIENT_SECRET ??= "secret";
process.env.DOTYPOS_CLOUD_ID ??= "cloud";
process.env.DOTYPOS_EMPLOYEE_ID ??= "employee";
process.env.DOTYPOS_REFRESH_TOKEN ??= "refresh";
process.env.GOOGLE_CALENDAR_ID ??= "calendar";
process.env.GOOGLE_CALENDAR_PRIVATE_KEY ??= "test-private-key";
process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL ??= "calendar@example.test";
process.env.NEXI_API_KEY ??= "nexi";
process.env.NEXI_API_ORIGIN ??= "https://xpaysandbox.nexigroup.com";
process.env.RESEND_WEBHOOK_SECRET ??= "whsec_test";
process.env.VERCEL_ENV ??= "development";
process.env.VERCEL_PROJECT_PRODUCTION_URL ??= "workspace.deskohub.test";
process.env.VERCEL_URL ??= "deskohub.test";
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??= "cloud";

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
process.env.NEXI_API_KEY ??= "nexi";
process.env.NEXI_API_ORIGIN ??= "https://xpaysandbox.nexigroup.com";
process.env.VERCEL_ENV ??= "development";
process.env.VERCEL_URL ??= "deskohub.test";
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??= "cloud";

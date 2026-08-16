import "@/shared/polyfills/temporal";

import { createHash } from "node:crypto";

const checkoutKey = Buffer.alloc(32, 7).toString("base64url");
const accountingSnapshotKey = "synthetic accounting snapshot secret!";
export const workspaceTestAdminCredentials = {
  password: "test-password",
  username: "admin",
} as const;

process.env.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID ??= "K202608";
process.env.ACCOUNTING_DOCUMENT_SNAPSHOT_KEY_K202608 ??= accountingSnapshotKey;
process.env.CHECKOUT_PAY_STATE_KEYS ??= `test:${checkoutKey}`;
process.env.RESERVATION_ACCESS_TOKEN_SECRET ??=
  "synthetic reservation access token secret";
process.env.CLOUDINARY_API_KEY ??= "test";
process.env.CLOUDINARY_API_SECRET ??= "test";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ADMIN_BASIC_AUTH_SHA256 ??= createHash("sha256")
  .update(
    `${workspaceTestAdminCredentials.username}:${workspaceTestAdminCredentials.password}`
  )
  .digest("hex");
process.env.DOTYPOS_API_URL ??= "https://dotypos.example";
process.env.DOTYPOS_BRANCH_ID ??= "branch";
process.env.DOTYPOS_CLIENT_ID ??= "client";
process.env.DOTYPOS_CLIENT_SECRET ??= "secret";
process.env.DOTYPOS_CLOUD_ID ??= "cloud";
process.env.DOTYPOS_EMPLOYEE_ID ??= "employee";
process.env.DOTYPOS_REFRESH_TOKEN ??= "refresh";
process.env.GOOGLE_CALENDAR_PRIVATE_KEY ??= "test-private-key";
process.env.GOOGLE_CALENDAR_SALES_ID ??= "sales-calendar";
process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL ??= "calendar@example.test";
process.env.GOOGLE_CALENDAR_WORKSPACE_LIMITATIONS_ID ??=
  "workspace-limitations-calendar";
process.env.IGLOOHOME_CLIENT_ID ??= "synthetic-client";
process.env.IGLOOHOME_CLIENT_SECRET ??= "synthetic-secret";
process.env.IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID ??= "fixture-ek1";
process.env.NEXI_API_KEY ??= "nexi";
process.env.NEXI_API_ORIGIN ??= "https://xpaysandbox.nexigroup.com";
process.env.NEXI_CHECKOUT_CURRENCY_OVERRIDE ??= "EUR";
process.env.POSTHOG_API_HOST ??= "https://posthog.example";
process.env.RESEND_WEBHOOK_SECRET ??= "whsec_test";
process.env.VERCEL_ENV ??= "development";
process.env.VERCEL_PROJECT_PRODUCTION_URL ??= "workspace.deskohub.test";
process.env.VERCEL_URL ??= "deskohub.test";
process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??= "cloud";

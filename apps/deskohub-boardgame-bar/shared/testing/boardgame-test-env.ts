import "@/shared/polyfills/temporal";

const webhookSecret = "00000000-0000-4000-8000-000000000000";

export const setBoardgameTestEnv = () => {
  if (
    !["development", "test", "production"].includes(process.env.NODE_ENV ?? "")
  ) {
    Object.assign(process.env, { NODE_ENV: "test" });
  }

  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.DOTYPOS_API_URL = "https://api.dotykacka.cz";
  process.env.DOTYPOS_BRANCH_ID = "branch-id";
  process.env.DOTYPOS_CLIENT_ID = "client-id";
  process.env.DOTYPOS_CLIENT_SECRET = "client-secret";
  process.env.DOTYPOS_CLOUD_ID = "cloud-id";
  process.env.DOTYPOS_EMPLOYEE_ID = "employee-id";
  process.env.DOTYPOS_REFRESH_TOKEN = "refresh-token";
  process.env.DOTYPOS_WEBHOOK_SECRET = webhookSecret;
  process.env.GOOGLE_CALENDAR_OPENING_HOURS_ID = "opening-hours-calendar";
  process.env.GOOGLE_CALENDAR_PRIVATE_KEY = "test-private-key";
  process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL = "calendar@example.test";
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";
  process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
  process.env.NEXT_PUBLIC_VERCEL_URL = "https://bar.example.test";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "https://bar.example.test";
};

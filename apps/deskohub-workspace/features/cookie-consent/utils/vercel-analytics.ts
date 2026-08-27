import type { BeforeSend } from "@vercel/analytics/react";
import { sanitizeAnalyticsUrl } from "@/shared/utils/analytics-url";

export const sanitizeVercelAnalyticsEvent: BeforeSend = (event) => ({
  ...event,
  url: sanitizeAnalyticsUrl(event.url),
});

import { headers } from "next/headers";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import type { ReservationData } from "@/features/reservation/schemas/reservation";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS_PER_WINDOW = 3;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const reservationRateLimitStore = new Map<string, RateLimitEntry>();

const getHeaderValue = (headerValue: string | null) =>
  headerValue?.trim() || "";

const getClientIp = (requestHeaders: Headers) => {
  const forwardedFor = getHeaderValue(requestHeaders.get("x-forwarded-for"));

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown-ip";
  }

  return (
    getHeaderValue(requestHeaders.get("x-real-ip")) ||
    getHeaderValue(requestHeaders.get("cf-connecting-ip")) ||
    "unknown-ip"
  );
};

const getRequestHost = (requestHeaders: Headers) =>
  getHeaderValue(requestHeaders.get("x-forwarded-host")) ||
  getHeaderValue(requestHeaders.get("host"));

const assertTrustedOrigin = (
  requestHeaders: Headers,
  locale: WorkspaceLocale
) => {
  const origin = getHeaderValue(requestHeaders.get("origin"));
  const host = getRequestHost(requestHeaders);

  if (!origin || !host) {
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new PublicSafeActionError(
      m.reservationSecurityInvalidOrigin({}, { locale })
    );
  }

  if (originHost === host) {
    return;
  }

  throw new PublicSafeActionError(
    m.reservationSecurityInvalidOrigin({}, { locale })
  );
};

const deleteExpiredRateLimits = (now: number) => {
  for (const [key, entry] of reservationRateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      reservationRateLimitStore.delete(key);
    }
  }
};

const createRateLimitKeys = (
  data: ReservationData,
  requestHeaders: Headers
) => {
  const clientIp = getClientIp(requestHeaders);
  const userAgent =
    getHeaderValue(requestHeaders.get("user-agent")) || "unknown-ua";
  const normalizedEmail = data.email.trim().toLowerCase();

  return [`ip:${clientIp}:ua:${userAgent}`, `email:${normalizedEmail}`];
};

const assertWithinRateLimit = (
  data: ReservationData,
  requestHeaders: Headers,
  locale: WorkspaceLocale
) => {
  const now = Date.now();
  const keys = createRateLimitKeys(data, requestHeaders);

  deleteExpiredRateLimits(now);

  for (const key of keys) {
    const entry = reservationRateLimitStore.get(key);

    if (entry && entry.count >= MAX_SUBMISSIONS_PER_WINDOW) {
      throw new PublicSafeActionError(
        m.reservationRateLimitMessage({}, { locale })
      );
    }
  }

  for (const key of keys) {
    const currentEntry = reservationRateLimitStore.get(key);

    if (!currentEntry) {
      reservationRateLimitStore.set(key, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
      continue;
    }

    reservationRateLimitStore.set(key, {
      ...currentEntry,
      count: currentEntry.count + 1,
    });
  }
};

export async function assertReservationRequestIsAllowed(
  data: ReservationData,
  locale: WorkspaceLocale
) {
  const requestHeaders = await headers();

  assertTrustedOrigin(requestHeaders, locale);

  // Best-effort per server instance. Production can replace this with a shared
  // store, edge middleware, or a bot challenge if reservation volume increases.
  assertWithinRateLimit(data, requestHeaders, locale);
}

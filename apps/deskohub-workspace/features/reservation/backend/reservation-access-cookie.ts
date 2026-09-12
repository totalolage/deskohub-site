import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Data, Effect, Option, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import {
  getReservationAccessTokenSecret,
  type ReservationAccessTokenError,
  type ReservationAccessTokenOptions,
} from "./reservation-access-token";

export const reservationAccessCookieMaxAgeSeconds = 60 * 60 * 24;
export const reservationAccessCookieMaxAgeMilliseconds =
  reservationAccessCookieMaxAgeSeconds * 1000;

const reservationAccessCookiePurpose = "reservation-access-cookie";
const reservationAccessCookieNamePrefix = "__Host-deskohub-reservation-access-";
const vercelPreviewProtectionQueryParams = [
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
] as const;
const reservationStatusQueryParams = new Set([
  "outcome",
  ...vercelPreviewProtectionQueryParams,
]);
const reservationAccessQueryParams = new Set(
  vercelPreviewProtectionQueryParams
);

const reservationAccessCookieClaimsSchema = Schema.Struct({
  purpose: Schema.Literal(reservationAccessCookiePurpose),
  orderId: workspaceReservationIdSchema,
  locale: Schema.Literals(locales),
  issuedAtEpochMilliseconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expiresAtEpochMilliseconds: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0)
  ),
});

type ReservationAccessCookieClaims =
  typeof reservationAccessCookieClaimsSchema.Type;

export type ReservationAccessCookieOptions = Pick<
  ReservationAccessTokenOptions,
  "now" | "secret"
>;

export type ReservationAccessCookieCapability = Pick<
  ReservationAccessCookieClaims,
  | "orderId"
  | "locale"
  | "issuedAtEpochMilliseconds"
  | "expiresAtEpochMilliseconds"
>;

export type ReservationAccessCookieStore = {
  readonly get: (name: string) => { readonly value: string } | undefined;
  readonly set: (
    name: string,
    value: string,
    options: ReservationAccessCookieSetOptions
  ) => void;
};

export type ReservationAccessCookieSetOptions = {
  readonly expires: Date;
  readonly httpOnly: true;
  readonly maxAge: number;
  readonly path: "/";
  readonly sameSite: "lax";
  readonly secure: true;
};

export class ReservationAccessCookieError extends Data.TaggedError(
  "ReservationAccessCookieError"
)<{
  readonly code:
    | "expired-cookie"
    | "invalid-cookie"
    | "invalid-secret"
    | "missing-secret"
    | "store-unavailable";
  readonly message: string;
}> {}

const invalidCookie = (message = "Reservation access cookie is invalid.") =>
  new ReservationAccessCookieError({ code: "invalid-cookie", message });

const getCookieLifetimeError = (
  claims: Pick<
    ReservationAccessCookieClaims,
    "issuedAtEpochMilliseconds" | "expiresAtEpochMilliseconds"
  >,
  now: number
) => {
  if (
    claims.issuedAtEpochMilliseconds > now ||
    claims.expiresAtEpochMilliseconds <= now ||
    claims.expiresAtEpochMilliseconds <= claims.issuedAtEpochMilliseconds ||
    claims.expiresAtEpochMilliseconds - claims.issuedAtEpochMilliseconds >
      reservationAccessCookieMaxAgeMilliseconds
  ) {
    return new ReservationAccessCookieError({
      code: "expired-cookie",
      message: "Reservation access cookie has expired.",
    });
  }
};

const mapSecretError = (error: ReservationAccessTokenError) =>
  new ReservationAccessCookieError({
    code:
      error.code === "missing-secret" || error.code === "invalid-secret"
        ? error.code
        : "invalid-cookie",
    message: "Reservation access cookie signing is unavailable.",
  });

const signClaims = (encodedClaims: string, key: Buffer) =>
  createHmac("sha256", key)
    .update(`${reservationAccessCookiePurpose}.${encodedClaims}`)
    .digest();

const hasValidCanonicalReservationSearchParams = (
  url: URL,
  allowedSearchParams: ReadonlySet<string>
) => {
  const searchParamCounts = new Map<string, number>();
  for (const [key] of url.searchParams) {
    if (!allowedSearchParams.has(key)) return false;
    searchParamCounts.set(key, (searchParamCounts.get(key) ?? 0) + 1);
  }
  if ([...searchParamCounts.values()].some((count) => count > 1)) {
    return false;
  }

  const setBypassCookie = url.searchParams.get("x-vercel-set-bypass-cookie");
  return setBypassCookie === null || setBypassCookie === "true";
};

export const getReservationAccessCookieName = (
  orderId: WorkspaceReservationId | string
) =>
  `${reservationAccessCookieNamePrefix}${createHash("sha256")
    .update(orderId)
    .digest("base64url")}`;

export const parseCanonicalReservationStatusUrl = (
  value: string,
  locale: Locale
): WorkspaceReservationId | undefined => {
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  let url: URL;
  try {
    url = new URL(value, "https://deskohub.local");
  } catch {
    return undefined;
  }

  if (url.hash) return undefined;

  const path = url.pathname.split("/");
  if (
    path.length !== 5 ||
    path[0] !== "" ||
    path.slice(2, 4).join("/") !== reservationStatusPath.slice(1)
  ) {
    return undefined;
  }

  const pathLocale = path[1];
  const pathOrderId = decodePathSegment(path[4]);
  if (!pathLocale || !pathOrderId) return undefined;

  const parsed = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        locale: Schema.Literals(locales),
        orderId: workspaceReservationIdSchema,
      })
    )({
      locale: pathLocale,
      orderId: pathOrderId,
    })
  );
  if (!parsed || parsed.locale !== locale) return undefined;

  if (
    !hasValidCanonicalReservationSearchParams(url, reservationStatusQueryParams)
  ) {
    return undefined;
  }

  const outcome = url.searchParams.get("outcome");
  if (outcome !== null && outcome !== "success" && outcome !== "cancelled") {
    return undefined;
  }

  return parsed.orderId;
};

export const parseCanonicalReservationAccessUrl = (
  value: string,
  locale: Locale
): WorkspaceReservationId | undefined => {
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  let url: URL;
  try {
    url = new URL(value, "https://deskohub.local");
  } catch {
    return undefined;
  }

  if (
    url.hash ||
    !hasValidCanonicalReservationSearchParams(url, reservationAccessQueryParams)
  ) {
    return undefined;
  }

  const path = url.pathname.split("/");
  if (
    path.length !== 5 ||
    path[0] !== "" ||
    path.slice(2, 4).join("/") !== reservationAccessPath.slice(1)
  ) {
    return undefined;
  }

  const pathLocale = path[1];
  const pathOrderId = decodePathSegment(path[4]);
  if (!pathLocale || !pathOrderId || pathLocale !== locale) return undefined;

  return Option.getOrUndefined(
    Schema.decodeOption(workspaceReservationIdSchema)(pathOrderId)
  );
};

export const sealReservationAccessCookie = Effect.fn(
  "reservationAccessCookie.seal"
)(function* (
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly capability: ReservationAccessCookieCapability;
  },
  options: ReservationAccessCookieOptions = {}
) {
  if (input.capability.orderId !== input.orderId) {
    return yield* invalidCookie();
  }

  const secret = yield* getReservationAccessTokenSecret(options).pipe(
    Effect.mapError(mapSecretError)
  );
  const claims = yield* Schema.decodeUnknownEffect(
    reservationAccessCookieClaimsSchema
  )({
    purpose: reservationAccessCookiePurpose,
    orderId: input.orderId,
    locale: input.capability.locale,
    issuedAtEpochMilliseconds: input.capability.issuedAtEpochMilliseconds,
    expiresAtEpochMilliseconds: input.capability.expiresAtEpochMilliseconds,
  }).pipe(Effect.mapError(() => invalidCookie()));
  const lifetimeError = getCookieLifetimeError(
    claims,
    options.now?.() ?? Date.now()
  );
  if (lifetimeError) return yield* lifetimeError;
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString(
    "base64url"
  );
  const signature = signClaims(encodedClaims, secret).toString("base64url");

  return `${encodedClaims}.${signature}`;
});

export const createReservationAccessCookieCapability = Effect.fn(
  "reservationAccessCookie.createCapability"
)(
  (
    input: {
      readonly orderId: WorkspaceReservationId;
      readonly locale: Locale;
    },
    options: ReservationAccessCookieOptions = {}
  ) => {
    const issuedAtEpochMilliseconds = options.now?.() ?? Date.now();

    return Effect.succeed({
      orderId: input.orderId,
      locale: input.locale,
      issuedAtEpochMilliseconds,
      expiresAtEpochMilliseconds:
        issuedAtEpochMilliseconds + reservationAccessCookieMaxAgeMilliseconds,
    } satisfies ReservationAccessCookieCapability);
  }
);

export const openReservationAccessCookie = Effect.fn(
  "reservationAccessCookie.open"
)(function* (
  input: {
    readonly value: string;
    readonly orderId: WorkspaceReservationId;
  },
  options: ReservationAccessCookieOptions = {}
) {
  const [encodedClaims, encodedSignature, ...extraParts] =
    input.value.split(".");
  if (extraParts.length > 0 || !encodedClaims || !encodedSignature) {
    return yield* invalidCookie();
  }

  const claims = yield* Effect.try({
    try: () =>
      JSON.parse(
        Buffer.from(encodedClaims, "base64url").toString("utf8")
      ) as unknown,
    catch: () => invalidCookie(),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(reservationAccessCookieClaimsSchema, {
        onExcessProperty: "error",
      })
    ),
    Effect.mapError(() => invalidCookie())
  );
  const secret = yield* getReservationAccessTokenSecret(options).pipe(
    Effect.mapError(mapSecretError)
  );
  const providedSignature = yield* Effect.try({
    try: () => Buffer.from(encodedSignature, "base64url"),
    catch: () => invalidCookie(),
  });
  const expectedSignature = signClaims(encodedClaims, secret);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return yield* invalidCookie();
  }

  if (claims.orderId !== input.orderId) {
    return yield* invalidCookie();
  }

  const lifetimeError = getCookieLifetimeError(
    claims,
    options.now?.() ?? Date.now()
  );
  if (lifetimeError) return yield* lifetimeError;

  return {
    orderId: claims.orderId,
    locale: claims.locale,
    issuedAtEpochMilliseconds: claims.issuedAtEpochMilliseconds,
    expiresAtEpochMilliseconds: claims.expiresAtEpochMilliseconds,
  } satisfies ReservationAccessCookieCapability;
});

export const readReservationAccessCookie = (
  store: Pick<ReservationAccessCookieStore, "get">,
  orderId: WorkspaceReservationId
) => store.get(getReservationAccessCookieName(orderId))?.value;

export const writeReservationAccessCookie = Effect.fn(
  "reservationAccessCookie.write"
)(function* (
  store: Pick<ReservationAccessCookieStore, "set">,
  input: {
    readonly orderId: WorkspaceReservationId;
    readonly capability: ReservationAccessCookieCapability;
  },
  options: ReservationAccessCookieOptions = {}
) {
  const now = options.now?.() ?? Date.now();
  const value = yield* sealReservationAccessCookie(input, {
    ...options,
    now: () => now,
  });
  const maxAge = Math.max(
    0,
    Math.floor((input.capability.expiresAtEpochMilliseconds - now) / 1_000)
  );
  store.set(getReservationAccessCookieName(input.orderId), value, {
    expires: new Date(input.capability.expiresAtEpochMilliseconds),
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
});

export type { ReservationAccessCookieClaims };

const decodePathSegment = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("/") ? undefined : decoded;
  } catch {
    return undefined;
  }
};

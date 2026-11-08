import { createHash } from "node:crypto";
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
import { makeSignedClaims } from "@/shared/backend/signed-claims";
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

const reservationAccessCookieClaims = makeSignedClaims({
  purpose: reservationAccessCookiePurpose,
  schema: reservationAccessCookieClaimsSchema,
});

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

type ReservationAccessCookieSetOptions = {
  readonly expires: Date;
  readonly httpOnly: true;
  readonly maxAge: number;
  readonly path: "/";
  readonly sameSite: "lax";
  readonly secure: true;
};

class ReservationAccessCookieError extends Data.TaggedError(
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

/**
 * A same-origin relative URL without a fragment, resolved against a
 * placeholder origin; anything else isn't canonical.
 */
const parseCanonicalRelativeUrl = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;

  const url = URL.parse(value, "https://deskohub.local");
  return url && !url.hash ? url : undefined;
};

/**
 * The raw locale and decoded reservation id of a
 * `/{locale}{routePath}/{orderId}` path, or nothing when the path has another
 * shape or an empty or slash-encoded segment.
 */
const readReservationPathSegments = (url: URL, routePath: string) => {
  const path = url.pathname.split("/");
  if (
    path.length !== 5 ||
    path[0] !== "" ||
    path.slice(2, 4).join("/") !== routePath.slice(1)
  ) {
    return undefined;
  }

  const pathLocale = path[1];
  const pathOrderId = decodePathSegment(path[4]);
  return pathLocale && pathOrderId
    ? { locale: pathLocale, orderId: pathOrderId }
    : undefined;
};

const decodeReservationStatusPathSegments = Schema.decodeUnknownOption(
  Schema.Struct({
    locale: Schema.Literals(locales),
    orderId: workspaceReservationIdSchema,
  })
);

const isCanonicalReservationStatusOutcome = (outcome: string | null) =>
  outcome === null || outcome === "success" || outcome === "cancelled";

export const parseCanonicalReservationStatusUrl = (
  value: string,
  locale: Locale
): WorkspaceReservationId | undefined => {
  const url = parseCanonicalRelativeUrl(value);
  if (!url) return undefined;

  const segments = readReservationPathSegments(url, reservationStatusPath);
  if (!segments) return undefined;

  const parsed = Option.getOrUndefined(
    decodeReservationStatusPathSegments(segments)
  );
  if (
    !parsed ||
    parsed.locale !== locale ||
    !hasValidCanonicalReservationSearchParams(
      url,
      reservationStatusQueryParams
    ) ||
    !isCanonicalReservationStatusOutcome(url.searchParams.get("outcome"))
  ) {
    return undefined;
  }

  return parsed.orderId;
};

export const parseCanonicalReservationAccessUrl = (
  value: string,
  locale: Locale
): WorkspaceReservationId | undefined => {
  const url = parseCanonicalRelativeUrl(value);
  if (
    !url ||
    !hasValidCanonicalReservationSearchParams(url, reservationAccessQueryParams)
  ) {
    return undefined;
  }

  const segments = readReservationPathSegments(url, reservationAccessPath);
  if (!segments || segments.locale !== locale) return undefined;

  return Option.getOrUndefined(
    Schema.decodeOption(workspaceReservationIdSchema)(segments.orderId)
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

  return yield* reservationAccessCookieClaims
    .sign(claims, [secret])
    .pipe(Effect.mapError(() => invalidCookie()));
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
  const claims = yield* reservationAccessCookieClaims
    .open(
      input.value,
      getReservationAccessTokenSecret(options).pipe(
        Effect.mapError(mapSecretError),
        Effect.map((secret) => [secret] as const)
      )
    )
    .pipe(
      Effect.catchTag("SignedClaimsError", () => Effect.fail(invalidCookie()))
    );

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

const decodeUriComponent = Option.liftThrowable(decodeURIComponent);

const decodePathSegment = (value: string | undefined) =>
  value
    ? decodeUriComponent(value).pipe(
        Option.filter((decoded) => !decoded.includes("/")),
        Option.getOrUndefined
      )
    : undefined;

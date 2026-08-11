import "server-only";

import { Effect, Schema } from "effect";
import {
  type MobileShopApiEnvelope,
  type MobileShopApiFailure,
  type MobileShopApiSuccess,
  type MobileShopErrorCode,
  mobileShopCreateOrderRequestSchema,
  mobileShopLocaleSchema,
  mobileShopPurchaseIdSchema,
  mobileShopQuoteRequestSchema,
} from "./contracts";
import { MobileShopFailure } from "./errors";
import {
  type IMobileShopService,
  MobileShopService,
} from "./mobile-shop.service";

const canonicalPwaOrigin = "https://app.workspace.deskohub.cz";
const mobileApiPrefix = "/api/v1/mobile";
const catalogCacheControl = "private, max-age=0, stale-while-revalidate=900";
const privateCacheControl = "private, no-store, max-age=0";

export const handleMobileShopApiRequest = Effect.fn(
  "mobileShop.handleApiRequest"
)(function* (request: Request) {
  const service = yield* MobileShopService;
  const originFailure = validateRequestOrigin(request);
  if (originFailure) return apiFailure(request, originFailure);

  if (request.method === "OPTIONS") return preflightResponse(request);
  if (isMutation(request) && !isValidWebMutation(request)) {
    return apiFailure(request, new MobileShopFailure({ code: "unauthorized" }));
  }

  const url = new URL(request.url);
  const segments = url.pathname
    .slice(mobileApiPrefix.length)
    .split("/")
    .filter(Boolean);

  return yield* routeMobileShopRequest({
    request,
    url,
    segments,
    service,
  }).pipe(
    Effect.catch((failure) => Effect.succeed(apiFailure(request, failure)))
  );
});

const routeMobileShopRequest = Effect.fn("mobileShop.routeApiRequest")(
  function* (input: {
    readonly request: Request;
    readonly url: URL;
    readonly segments: readonly string[];
    readonly service: IMobileShopService;
  }) {
    const { request, segments, service, url } = input;

    if (request.method === "GET" && segments.join("/") === "account") {
      return apiSuccess(request, yield* service.account(request));
    }

    if (request.method === "GET" && segments.join("/") === "catalog") {
      const locale = yield* decodeBoundary(
        mobileShopLocaleSchema,
        url.searchParams.get("locale") ?? "en-US"
      );
      const catalog = yield* service.catalog({ request, locale });
      const etag = `"${catalog.version}"`;
      if (request.headers.get("if-none-match") === etag) {
        return withApiHeaders(request, new Response(null, { status: 304 }), {
          cacheControl: catalogCacheControl,
          etag,
          varyLocale: true,
        });
      }
      return apiSuccess(request, catalog, {
        cacheControl: catalogCacheControl,
        etag,
        varyLocale: true,
      });
    }

    if (request.method === "POST" && segments.join("/") === "quotes") {
      const quoteRequest = yield* decodeRequestJson(
        request,
        mobileShopQuoteRequestSchema
      );
      return apiSuccess(
        request,
        yield* service.quote({ request, quoteRequest })
      );
    }

    if (segments[0] === "orders" && segments.length === 1) {
      if (request.method === "GET") {
        const before = yield* decodeOptionalInstant(
          url.searchParams.get("before")
        );
        const limit = decodeHistoryLimit(url.searchParams.get("limit"));
        return apiSuccess(
          request,
          yield* service.history({ request, before, limit })
        );
      }
      if (request.method === "POST") {
        const orderRequest = yield* decodeRequestJson(
          request,
          mobileShopCreateOrderRequestSchema
        );
        return apiSuccess(
          request,
          yield* service.createOrder({ request, orderRequest }),
          { status: 201 }
        );
      }
    }

    if (segments[0] === "orders" && segments[1]) {
      const orderId = yield* decodeBoundary(
        mobileShopPurchaseIdSchema,
        segments[1]
      );
      if (request.method === "GET" && segments.length === 2) {
        return apiSuccess(request, yield* service.order({ request, orderId }));
      }
      if (
        request.method === "POST" &&
        segments.length === 3 &&
        segments[2] === "payment"
      ) {
        return apiSuccess(
          request,
          yield* service.payment({ request, orderId })
        );
      }
    }

    return apiFailure(
      request,
      new MobileShopFailure({ code: "order_not_found" })
    );
  }
);

const decodeRequestJson = <A>(request: Request, schema: Schema.Decoder<A>) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) => new MobileShopFailure({ code: "invalid_cart", cause }),
  }).pipe(Effect.flatMap((input) => decodeBoundary(schema, input)));

const decodeBoundary = <A>(schema: Schema.Decoder<A>, input: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(
      (cause) => new MobileShopFailure({ code: "invalid_cart", cause })
    )
  );

const decodeOptionalInstant = (value: string | null) => {
  if (!value) return Effect.succeed(undefined);
  return Effect.try({
    try: () => Temporal.Instant.from(value),
    catch: (cause) => new MobileShopFailure({ code: "invalid_cart", cause }),
  });
};

const decodeHistoryLimit = (value: string | null) => {
  if (!value || !/^\d+$/.test(value)) return 20;
  return Math.max(1, Math.min(50, Number(value)));
};

const validateRequestOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  return isAllowedOrigin(request, origin)
    ? undefined
    : new MobileShopFailure({ code: "unauthorized" });
};

const isAllowedOrigin = (request: Request, origin: string) =>
  origin === new URL(request.url).origin || origin === canonicalPwaOrigin;

const isMutation = (request: Request) =>
  !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());

const isValidWebMutation = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (fetchSite === "same-origin" || fetchSite === "same-site") &&
    request.headers.get("x-deskohub-csrf") === "1"
  );
};

const preflightResponse = (request: Request) => {
  const response = new Response(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, If-None-Match, X-Deskohub-CSRF"
  );
  response.headers.set("Access-Control-Max-Age", "600");
  return withApiHeaders(request, response, {
    cacheControl: privateCacheControl,
  });
};

const apiSuccess = <A>(
  request: Request,
  data: A,
  options: {
    readonly status?: number;
    readonly cacheControl?: string;
    readonly etag?: string;
    readonly varyLocale?: boolean;
  } = {}
) => {
  const body: MobileShopApiSuccess<A> = { ok: true, data };
  return withApiHeaders(
    request,
    Response.json(body satisfies MobileShopApiEnvelope<A>, {
      status: options.status ?? 200,
    }),
    {
      cacheControl: options.cacheControl ?? privateCacheControl,
      etag: options.etag,
      varyLocale: options.varyLocale,
    }
  );
};

const apiFailure = (request: Request, failure: MobileShopFailure) => {
  const body: MobileShopApiFailure = {
    ok: false,
    error: { code: failure.code },
  };
  return withApiHeaders(
    request,
    Response.json(body, { status: statusFor(failure.code) }),
    {
      cacheControl: privateCacheControl,
    }
  );
};

const statusFor = (code: MobileShopErrorCode) => {
  switch (code) {
    case "unauthorized":
      return 401;
    case "commerce_identity_unavailable":
    case "no_active_reservation":
      return 403;
    case "order_not_found":
    case "order_not_owned":
      return 404;
    case "catalog_changed":
    case "idempotency_conflict":
    case "payment_pending":
      return 409;
    case "invalid_cart":
    case "quantity_limit_exceeded":
      return 400;
    case "catalog_unavailable":
    case "payment_unavailable":
    case "service_unavailable":
      return 503;
  }
};

const withApiHeaders = (
  request: Request,
  response: Response,
  options: {
    readonly cacheControl: string;
    readonly etag?: string;
    readonly varyLocale?: boolean;
  }
) => {
  response.headers.set("Cache-Control", options.cacheControl);
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (options.etag) response.headers.set("ETag", options.etag);

  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(request, origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  response.headers.set(
    "Vary",
    [
      "Origin",
      "Cookie",
      "Authorization",
      ...(options.varyLocale ? ["Accept-Language"] : []),
    ].join(", ")
  );
  return response;
};

export const mobileShopApiCachePolicy = {
  catalog: catalogCacheControl,
  private: privateCacheControl,
  staleWhileRevalidateSeconds: 900,
} as const;

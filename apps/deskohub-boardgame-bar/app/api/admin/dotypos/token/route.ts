import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { DotyposOAuthService } from "@/features/dotypos/backend/oauth.service";

const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

function isTokenRequest(
  body: unknown
): body is { code: string; locale?: string } {
  const input = body as { readonly code?: unknown; readonly locale?: unknown };
  return (
    body !== null &&
    typeof body === "object" &&
    typeof input.code === "string" &&
    input.code.length > 0 &&
    (input.locale === undefined || typeof input.locale === "string")
  );
}

function resolveRequestOrigin(request: NextRequest): URL {
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host) {
    return new URL(request.nextUrl.origin);
  }

  return new URL(`${protocol}://${host}`);
}

function resolveLocale(
  body: { code: string; locale?: string },
  request: NextRequest
): string {
  const queryLocale = request.nextUrl.searchParams.get("locale");
  const localeCandidate = body.locale ?? queryLocale ?? "en-US";
  return LOCALE_PATTERN.test(localeCandidate) ? localeCandidate : "en-US";
}

export async function POST(request: NextRequest) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.logInfo("Dotypos token request received");
      yield* Effect.logDebug("Dotypos token request body parse started");
      const body: unknown = yield* Effect.tryPromise({
        try: () => request.json() as Promise<unknown>,
        catch: (cause) => cause,
      });
      yield* Effect.logInfo("Dotypos token request body parsed");

      if (!isTokenRequest(body)) {
        yield* Effect.logWarning("Invalid Dotypos token request body");
        return NextResponse.json(
          { error: "Invalid request body - authorization code is required" },
          { status: 400 }
        );
      }

      const { code } = body;

      const locale = resolveLocale(body, request);
      const origin = resolveRequestOrigin(request);
      const redirectUrl = new URL(
        `/${locale}/admin/dotypos/callback`,
        origin
      ).toString();
      yield* Effect.logInfo("Dotypos token redirect URL resolved");

      const oauth = yield* DotyposOAuthService;
      const tokenData = yield* oauth.exchangeCode({
        code,
        redirectUri: redirectUrl,
      });
      yield* Effect.logInfo("Dotypos token response received");

      // Token exchange successful
      yield* Effect.logInfo("Dotypos token exchange succeeded");

      // In production, you would save these tokens securely
      // For now, we'll return them to display in the UI
      const response = NextResponse.json({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        tokenType: tokenData.tokenType,
      });
      yield* Effect.logInfo("Dotypos token response ready");
      return response;
    }).pipe(
      Effect.scoped,
      Effect.provide(DotyposOAuthService.Live),
      Effect.catchTags({
        DotyposOAuthConfigError: (error: { readonly message: string }) =>
          Effect.succeed(
            NextResponse.json({ error: error.message }, { status: 500 })
          ),
        DotyposTokenExchangeError: (error: {
          readonly details: string;
          readonly status: number;
        }) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Token exchange failed", details: error.details },
              { status: error.status }
            )
          ),
        DotyposTokenResponseError: (error: { readonly message: string }) =>
          Effect.succeed(
            NextResponse.json({ error: error.message }, { status: 500 })
          ),
      }),
      Effect.catch((error) =>
        Effect.logError("Dotypos token route failed", { error }).pipe(
          Effect.as(
            NextResponse.json(
              { error: "Internal server error" },
              { status: 500 }
            )
          )
        )
      )
    )
  );
}

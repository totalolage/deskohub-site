import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

function isTokenRequest(
  body: unknown
): body is { code: string; locale?: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "code" in body &&
    typeof (body as Record<string, unknown>).code === "string" &&
    (!("locale" in body) ||
      typeof (body as Record<string, unknown>).locale === "string")
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

function isTokenResponse(data: unknown): data is {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
} {
  return data !== null && typeof data === "object";
}

export async function POST(request: NextRequest) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({
        request: {
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
          searchParams: Object.fromEntries(request.nextUrl.searchParams),
          url: request.url,
        },
      });
      yield* Effect.logInfo("Dotypos token request received");
      yield* Effect.logDebug("Dotypos token request body parse started");
      const body: unknown = yield* Effect.tryPromise({
        try: () => request.json() as Promise<unknown>,
        catch: (cause) => cause,
      });
      yield* Effect.annotateLogsScoped({ body });
      yield* Effect.logInfo("Dotypos token request body parsed");

      if (!isTokenRequest(body)) {
        yield* Effect.logWarning("Invalid Dotypos token request body");
        return NextResponse.json(
          { error: "Invalid request body - authorization code is required" },
          { status: 400 }
        );
      }

      const { code } = body;

      // Token exchange API called with authorization code

      if (!code) {
        yield* Effect.logWarning("Dotypos token request missing code");
        return NextResponse.json(
          { error: "Authorization code is required" },
          { status: 400 }
        );
      }

      const clientId = env.DOTYPOS_CLIENT_ID;
      const clientSecret = env.DOTYPOS_CLIENT_SECRET;
      const locale = resolveLocale(body, request);
      const origin = resolveRequestOrigin(request);
      const redirectUrl = new URL(
        `/${locale}/admin/dotypos/callback`,
        origin
      ).toString();
      yield* Effect.annotateLogsScoped({
        locale,
        origin: origin.toString(),
        redirectUrl,
      });
      yield* Effect.logInfo("Dotypos token redirect URL resolved");

      // Using configured OAuth2 credentials

      if (!clientId || !clientSecret) {
        yield* Effect.logWarning("Missing Dotypos configuration");
        return NextResponse.json(
          { error: "Missing Dotypos configuration" },
          { status: 500 }
        );
      }

      // Exchange authorization code for tokens
      const tokenUrl = "https://api.dotykacka.cz/v2/oauth/token";
      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUrl,
      });
      yield* Effect.annotateLogsScoped({
        tokenParams: Object.fromEntries(tokenParams),
        tokenUrl,
      });

      // Sending token exchange request to Dotypos
      yield* Effect.logInfo("Dotypos token exchange request started");

      const tokenResponse = yield* Effect.tryPromise({
        try: () =>
          fetch(tokenUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: tokenParams,
          }),
        catch: (cause) => cause,
      });

      // Received token response from Dotypos

      if (!tokenResponse.ok) {
        const errorData = yield* Effect.tryPromise({
          try: () => tokenResponse.text(),
          catch: (cause) => cause,
        });
        yield* Effect.logWarning("Dotypos token exchange failed", {
          errorData,
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
        });
        return NextResponse.json(
          { error: "Token exchange failed", details: errorData },
          { status: tokenResponse.status }
        );
      }

      const tokenData: unknown = yield* Effect.tryPromise({
        try: () => tokenResponse.json() as Promise<unknown>,
        catch: (cause) => cause,
      });
      yield* Effect.annotateLogsScoped({ tokenData });
      yield* Effect.logInfo("Dotypos token response received");

      if (!isTokenResponse(tokenData)) {
        yield* Effect.logWarning("Invalid Dotypos token response");
        return NextResponse.json(
          { error: "Invalid token response format" },
          { status: 500 }
        );
      }

      // Token exchange successful
      yield* Effect.logInfo("Dotypos token exchange succeeded");

      // In production, you would save these tokens securely
      // For now, we'll return them to display in the UI
      const response = NextResponse.json({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
      });
      yield* Effect.logInfo("Dotypos token response ready");
      return response;
    }).pipe(
      Effect.scoped,
      Effect.catchAll((error) =>
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

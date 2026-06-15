import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";

const DOTYPOS_OAUTH_URL = "https://admin.dotypos.com/client/connect";
const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

const resolveLocale = (request: NextRequest): string => {
  const input = request.nextUrl.searchParams.get("locale") ?? "en-US";
  return LOCALE_PATTERN.test(input) ? input : "en-US";
};

const resolveRequestOrigin = (request: NextRequest): URL => {
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host) {
    return new URL(request.nextUrl.origin);
  }

  return new URL(`${protocol}://${host}`);
};

export async function GET(request: NextRequest): Promise<NextResponse> {
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
      yield* Effect.logInfo("Dotypos auth URL request received");

      if (!env.DOTYPOS_CLIENT_ID || !env.DOTYPOS_CLIENT_SECRET) {
        yield* Effect.logWarning("Missing Dotypos configuration");
        return NextResponse.json(
          { error: "Missing Dotypos configuration" },
          { status: 500 }
        );
      }

      const locale = resolveLocale(request);
      const origin = resolveRequestOrigin(request);
      const redirectUri = new URL(`/${locale}/admin/dotypos/callback`, origin);

      const state = Math.random().toString(36).slice(2);
      const authUrl = new URL(DOTYPOS_OAUTH_URL);
      authUrl.searchParams.append("client_id", env.DOTYPOS_CLIENT_ID);
      authUrl.searchParams.append("client_secret", env.DOTYPOS_CLIENT_SECRET);
      authUrl.searchParams.append("scope", "*");
      authUrl.searchParams.append("redirect_uri", redirectUri.toString());
      authUrl.searchParams.append("state", state);
      yield* Effect.annotateLogsScoped({
        authUrl: authUrl.toString(),
        locale,
        origin: origin.toString(),
        redirectUri: redirectUri.toString(),
        state,
      });
      yield* Effect.logInfo("Dotypos auth URL constructed");

      const response = NextResponse.json({
        authUrl: authUrl.toString(),
        redirectUri: redirectUri.toString(),
      });
      yield* Effect.logInfo("Dotypos auth URL response ready");
      return response;
    }).pipe(Effect.scoped)
  );
}

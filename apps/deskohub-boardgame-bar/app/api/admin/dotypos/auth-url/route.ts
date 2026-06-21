import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { DotyposOAuthService } from "@/features/dotypos/backend/oauth.service";

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
      yield* Effect.logInfo("Dotypos auth URL request received");

      const locale = resolveLocale(request);
      const origin = resolveRequestOrigin(request);
      const redirectUri = new URL(`/${locale}/admin/dotypos/callback`, origin);

      const oauth = yield* DotyposOAuthService;
      const { authUrl } = yield* oauth.getAuthUrl({
        redirectUri: redirectUri.toString(),
      });
      yield* Effect.logInfo("Dotypos auth URL constructed");

      const response = NextResponse.json({
        authUrl,
        redirectUri: redirectUri.toString(),
      });
      yield* Effect.logInfo("Dotypos auth URL response ready");
      return response;
    }).pipe(
      Effect.scoped,
      Effect.provide(DotyposOAuthService.Live),
      Effect.catchTag(
        "DotyposOAuthConfigError",
        (error: { readonly message: string }) =>
          Effect.succeed(
            NextResponse.json({ error: error.message }, { status: 500 })
          )
      )
    )
  );
}

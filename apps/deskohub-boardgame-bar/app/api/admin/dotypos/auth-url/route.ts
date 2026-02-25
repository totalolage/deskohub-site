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
  if (!env.DOTYPOS_CLIENT_ID || !env.DOTYPOS_CLIENT_SECRET) {
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

  return NextResponse.json({
    authUrl: authUrl.toString(),
    redirectUri: redirectUri.toString(),
  });
}

import { Option } from "effect";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLocalizedParamsDecoder } from "@/features/i18n/server/route-params";
import { createMarketingManagementCookies } from "@/features/legal/backend/marketing-management-cookies.server";

type MarketingPreferencesAccessRouteContext = {
  readonly params: Promise<{ readonly locale: string }>;
};

const decodeRouteParams = getLocalizedParamsDecoder({});
const canonicalMarketingTokenPattern = /^[A-Za-z0-9_-]{43}$/;

const isCanonicalMarketingToken = (
  value: string | undefined
): value is string => {
  if (!value || !canonicalMarketingTokenPattern.test(value)) return false;

  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === 32 && decoded.toString("base64url") === value;
};

const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

const getLocale = async (
  params: MarketingPreferencesAccessRouteContext["params"]
) => Option.getOrUndefined(decodeRouteParams(await params))?.locale;

const invalidRouteResponse = () =>
  new NextResponse(null, { headers: privateHeaders, status: 404 });

const redirectToLegal = (request: Request, locale: string) => {
  const response = NextResponse.redirect(
    new URL(`/${locale}/account/legal`, request.url),
    303
  );
  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  response.headers.set("Referrer-Policy", privateHeaders["Referrer-Policy"]);
  return response;
};

export async function GET(
  request: Request,
  { params }: MarketingPreferencesAccessRouteContext
) {
  const locale = await getLocale(params);
  if (!locale) return invalidRouteResponse();

  const tokenValues = new URL(request.url).searchParams.getAll("token");
  const rawToken = tokenValues.length === 1 ? tokenValues[0] : undefined;
  const cookieStore = await cookies();
  const marketingCookies = createMarketingManagementCookies(cookieStore);
  await marketingCookies.setPendingMarketingManagementCookie(
    isCanonicalMarketingToken(rawToken) ? rawToken : "invalid"
  );

  return redirectToLegal(request, locale);
}

export async function HEAD(
  request: Request,
  { params }: MarketingPreferencesAccessRouteContext
) {
  const locale = await getLocale(params);
  if (!locale) return invalidRouteResponse();

  return redirectToLegal(request, locale);
}

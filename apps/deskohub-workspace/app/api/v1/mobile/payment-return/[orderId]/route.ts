import { NextResponse } from "next/server";
import { env } from "@/env";

const canonicalMobileAppOrigin = "https://app.workspace.deskohub.cz";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly orderId: string }> }
) {
  const { orderId } = await context.params;
  const requestUrl = new URL(request.url);
  const locale =
    requestUrl.searchParams.get("locale") === "cs-CZ" ? "cs-CZ" : "en-US";
  const cancelled = requestUrl.searchParams.get("outcome") === "cancelled";

  if (env.VERCEL_ENV === "production") {
    const target = new URL(
      `/payment/${encodeURIComponent(orderId)}`,
      canonicalMobileAppOrigin
    );
    if (cancelled) target.searchParams.set("outcome", "cancelled");
    return NextResponse.redirect(target, 303);
  }

  const copy =
    locale === "cs-CZ"
      ? {
          title: "Návrat z platby",
          body: "Tuto kartu můžete zavřít a vrátit se do aplikace Deskohub Workspace. Stav platby se ověří v připojeném náhledovém prostředí.",
        }
      : {
          title: "Payment return",
          body: "You can close this tab and return to the Deskohub Workspace app. Payment status will be checked against the connected preview environment.",
        };
  const response = new NextResponse(renderReturnPage(copy, locale), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

const renderReturnPage = (
  copy: {
    readonly title: string;
    readonly body: string;
  },
  locale: "cs-CZ" | "en-US"
) => `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${copy.title}</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f2ea; color: #15243a; }
      main { box-sizing: border-box; width: min(36rem, calc(100% - 2rem)); padding: 2rem; border-radius: 1.25rem; background: white; box-shadow: 0 1rem 3rem rgb(21 36 58 / 12%); }
      h1 { margin: 0 0 .75rem; font-size: 1.75rem; }
      p { margin: 0; line-height: 1.6; }
    </style>
  </head>
  <body><main><h1>${copy.title}</h1><p>${copy.body}</p></main></body>
</html>`;

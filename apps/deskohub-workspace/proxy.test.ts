import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { indexNowKeyPathname } from "@/features/public-pages";
import { referralCodeCookieName } from "@/features/referrals/referral-code-cookie";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import { runCommand } from "@/scripts/shared/command";
import type { AgentPageRequest } from "@/shared/backend/agent-traffic/agent-page-request";

let administrationAccessResult:
  | "administrator"
  | "signed-out"
  | "not-administrator" = "administrator";
let administrationAccessFailure: unknown;
const administrationRequestHeaders: Headers[] = [];
const readAdministrationRequestAccess = async (headers: Headers) => {
  administrationRequestHeaders.push(headers);
  if (administrationAccessFailure !== undefined) {
    throw administrationAccessFailure;
  }
  return administrationAccessResult;
};

mock.module(
  "./features/administrators/server/administration-request-access.server",
  () => ({ readAdministrationRequestAccess })
);
const scheduledAgentPageRequests: AgentPageRequest[] = [];
mock.module("./shared/backend/agent-traffic/agent-page-request", () => ({
  scheduleAgentPageRequest: (pageRequest: AgentPageRequest) => {
    scheduledAgentPageRequests.push(pageRequest);
  },
}));
const { config, proxy } = await import("./proxy");

beforeEach(() => {
  administrationAccessResult = "administrator";
  administrationAccessFailure = undefined;
  administrationRequestHeaders.length = 0;
  scheduledAgentPageRequests.length = 0;
});

// A signed-in request reads the saved language preference, whose logs share
// stdout with the inspection result.
const inspectionMarker = "proxy-inspection:";
const inspectedResponses = (result: { readonly stdout: string }) =>
  JSON.parse(
    result.stdout.slice(
      result.stdout.lastIndexOf(inspectionMarker) + inspectionMarker.length
    )
  );

const inspectCheckoutEntry = (
  deploymentEnvironment: "preview" | "production" | "development"
) =>
  runCommand(
    [
      process.execPath,
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "-e",
      `
        const { NextRequest } = await import("next/server");
        const { proxy } = await import("./proxy.ts");
        const requests = [
          ["https://branch-preview.vercel.app/en-US/checkout/pay?state=synthetic%2Bsummary", {}],
          ["https://branch-preview.vercel.app/cs-CZ/checkout/pay?state=synthetic-summary", { method: "HEAD" }],
          ["https://branch-preview.vercel.app/checkout/pay?state=synthetic-summary", {}],
          ["https://immutable-preview.vercel.app/en-US/checkout/pay", {}],
          ["https://branch-preview.vercel.app/en-US/cowork", {}],
          ["https://branch-preview.vercel.app/en-US/checkout/pay/return/synthetic-order", {}],
          ["https://branch-preview.vercel.app/en-US/checkout/pay", { method: "POST", headers: { "next-action": "synthetic-action" } }],
          ["https://branch-preview.vercel.app/en-US/checkout/pay?state=synthetic-summary", { headers: { rsc: "1" } }],
          ["https://branch-preview.vercel.app/en-US/account", {}],
          ["https://immutable-preview.vercel.app/en-US/account", { headers: { cookie: "better-auth.session_token=synthetic-session" } }],
          ["https://branch-preview.vercel.app/en-US", {}],
          ["https://branch-preview.vercel.app/en-US/reservation/cowork", {}],
          ["https://workspace.deskohub.cz/en-US/checkout/pay?state=synthetic-summary", {}],
          ["https://immutable-preview.vercel.app/en/faq?utm_source=synthetic", {}],
          ["https://branch-preview.vercel.app/en-US/admin", { method: "HEAD" }],
          ["https://branch-preview.vercel.app/cs-CZ/reservation/access/synthetic-order?accessToken=synthetic-token", {}],
        ];
        const results = [];
        for (const [url, options] of requests) {
          const response = await proxy(new NextRequest(url, options));
          results.push({
            status: response.status,
            location: response.headers.get("location"),
            cacheControl: response.headers.get("cache-control"),
            referrerPolicy: response.headers.get("referrer-policy"),
          });
        }
        process.stdout.write("\\n${inspectionMarker}" + JSON.stringify(results));
      `,
    ],
    {
      cwd: import.meta.dir,
      env: {
        ...process.env,
        VERCEL_ENV: deploymentEnvironment,
        // Deployed environments require a Resend key; the test env omits it.
        EMAIL_API_KEY: "re_test",
        VERCEL_URL: "immutable-preview.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "workspace.example",
        VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-preview-bypass",
      },
    }
  );

// Each environment needs its own process because `env` captures VERCEL_ENV at
// load; tests share one inspection per environment.
const checkoutEntryInspections = new Map<
  "preview" | "production" | "development",
  ReturnType<typeof inspectCheckoutEntry>
>();
const inspectCheckoutEntryOnce = (
  deploymentEnvironment: "preview" | "production" | "development"
) => {
  const existing = checkoutEntryInspections.get(deploymentEnvironment);
  if (existing) return existing;

  const inspection = inspectCheckoutEntry(deploymentEnvironment);
  checkoutEntryInspections.set(deploymentEnvironment, inspection);
  return inspection;
};

test("starts Preview payment on the callback host before issuing its host-only cookie", async () => {
  const result = await inspectCheckoutEntryOnce("preview");
  expect(result.exitCode).toBe(0);
  const responses = inspectedResponses(result);

  for (const index of [0, 1, 2, 7]) {
    const response = responses[index];
    expect(response.status).toBe(307);
    const location = new URL(response.location);
    expect(location.origin).toBe("https://immutable-preview.vercel.app");
    expect(location.pathname).toBe(
      ["/en-US/checkout/pay", "/cs-CZ/checkout/pay", "/checkout/pay"][index] ??
        "/en-US/checkout/pay"
    );
    expect(location.searchParams.get("state")).toBe(
      index === 0 ? "synthetic+summary" : "synthetic-summary"
    );
    expect(location.searchParams.get("x-vercel-protection-bypass")).toBe(
      "synthetic-preview-bypass"
    );
    expect(location.searchParams.get("x-vercel-set-bypass-cookie")).toBe(
      "true"
    );
    expect(response.cacheControl).toBe("private, no-store");
    expect(response.referrerPolicy).toBe("no-referrer");
  }

  for (const index of [4, 5]) {
    expect(responses[index].status).toBe(307);
    expect(new URL(responses[index].location).origin).toBe(
      "https://immutable-preview.vercel.app"
    );
  }
  for (const index of [3, 6]) {
    expect(responses[index].location).toBeNull();
    expect(responses[index].status).toBe(200);
  }
});

test("uses the Preview callback host before sign-in and reservation preparation", async () => {
  const result = await inspectCheckoutEntryOnce("preview");
  expect(result.exitCode).toBe(0);
  const responses = inspectedResponses(result);
  for (const index of [8, 10, 11]) {
    expect(responses[index].status).toBe(307);
    expect(new URL(responses[index].location).origin).toBe(
      "https://immutable-preview.vercel.app"
    );
  }
  expect(responses[9].location).toBeNull();
  expect(responses[9].status).toBe(200);
});

test("retains Development payment origins", async () => {
  const result = await inspectCheckoutEntryOnce("development");
  expect(result.exitCode).toBe(0);
  const responses = inspectedResponses(result);
  for (const index of [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    expect(responses[index].location).toBeNull();
  }
});

test("moves Production alias page loads to the canonical origin with their path and query", async () => {
  const result = await inspectCheckoutEntryOnce("production");
  expect(result.exitCode).toBe(0);
  const responses = inspectedResponses(result);
  const canonicalUrls = new Map([
    [
      0,
      "https://workspace.deskohub.cz/en-US/checkout/pay?state=synthetic%2Bsummary",
    ],
    [
      1,
      "https://workspace.deskohub.cz/cs-CZ/checkout/pay?state=synthetic-summary",
    ],
    [3, "https://workspace.deskohub.cz/en-US/checkout/pay"],
    [10, "https://workspace.deskohub.cz/en-US"],
    [13, "https://workspace.deskohub.cz/en/faq?utm_source=synthetic"],
    [14, "https://workspace.deskohub.cz/en-US/admin"],
    [
      15,
      "https://workspace.deskohub.cz/cs-CZ/reservation/access/synthetic-order?accessToken=synthetic-token",
    ],
  ]);
  for (const [index, canonicalUrl] of canonicalUrls) {
    expect(responses[index].status).toBe(308);
    expect(responses[index].location).toBe(canonicalUrl);
  }
  // The query can carry a credential, so private paths redirect privately.
  for (const index of [8, 14, 15]) {
    expect(responses[index].cacheControl).toBe("private, no-store");
  }
  expect(responses[15].referrerPolicy).toBe("no-referrer");
  expect(responses[10].cacheControl).toBeNull();
  // A Server Action finishes where it was posted; the canonical host serves.
  for (const index of [6, 12]) {
    expect(responses[index].location).toBeNull();
    expect(responses[index].status).toBe(200);
  }
});

test("lets Preview deployments serve a bare language on their own host", async () => {
  const result = await inspectCheckoutEntryOnce("preview");
  expect(result.exitCode).toBe(0);
  const response = inspectedResponses(result)[13];
  expect(response.status).toBe(308);
  expect(response.location).toBe(
    "https://immutable-preview.vercel.app/en-US/faq?utm_source=synthetic"
  );
});

const unprefixedAdministrationPaths = [
  "/admin",
  "/admin/",
  "/admin/bookings",
  "/admin/bookings/booking-id",
  "/admin/reservations",
  "/admin/reservations/reservation-id",
  "/admin/customers",
  "/admin/customers/customer-id",
  "/admin/customers/customer-id/create-code",
  "/admin/customers/customer-id/create-voucher",
  "/admin/discounts",
  "/admin/codes",
  "/admin/codes/code-id",
  "/admin/sales",
  "/admin/invoices/invoice-id/pdf",
] as const;

const administrationPaths = [
  ...unprefixedAdministrationPaths,
  ...unprefixedAdministrationPaths.flatMap((pathname) => [
    `/en-US${pathname}`,
    `/cs-CZ${pathname}`,
  ]),
];

const sessionCookie = "better-auth.session_token=synthetic-session";

const expectPrivateAdministrationResponse = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const vary = response.headers
    .get("vary")
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  expect(vary).toContain("cookie");
  expect(vary).not.toContain("authorization");
};

describe("administration route boundary", () => {
  test("matches every administration route including dotted identifiers", () => {
    for (const pathname of [
      ...administrationPaths,
      "/admin//reservations",
      "/admin/reservations/reservation.with.dots",
      "/admin/reservations/reservation%2Ewith%2Edots",
      "/admin/customers/customer.with.dots/create-code",
      "/cs-CZ/admin/reservations/reservation.with.dots",
      "/en-US/admin/invoices/invoice.with.dots/pdf",
    ]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://workspace.example${pathname}`,
        })
      ).toBe(true);
    }
  });

  test("does not classify paths with an admin-like prefix as administration", async () => {
    for (const pathname of ["/administrator", "/admin-help"]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example/cs-CZ${pathname}`
      );
    }
  });

  test("redirects every concrete administration route without a session cookie", async () => {
    for (const pathname of administrationPaths) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toMatch(
        /^\/(?:en-US|cs-CZ)\/auth\/sign-in$/
      );
      expectPrivateAdministrationResponse(response);
    }
    expect(administrationRequestHeaders).toHaveLength(0);
  });

  test("recognizes encoded, odd, and malformed administration path spellings", async () => {
    for (const pathname of [
      "/xx-XX/admin",
      "/%61dmin/reservations",
      "/cs-CZ/%61dmin",
      "/en-US/admin%2Freservations",
      "/en-US/admin/%",
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toMatch(
        /^\/(?:en-US|cs-CZ)\/auth\/sign-in$/
      );
      expectPrivateAdministrationResponse(response);
    }
  });

  test("moves a loosely spelled administration locale to the exact locale privately", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/cs-cz/admin/reservations")
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/admin/reservations"
    );
    expectPrivateAdministrationResponse(response);
  });

  test("redirects a cookie-less localized invoice request to sign-in with its return path", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/invoices?page=2")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/en-US/auth/sign-in?returnTo=%2Fen-US%2Fadmin%2Finvoices%3Fpage%3D2"
    );
    expectPrivateAdministrationResponse(response);
  });

  test("uses Accept-Language for cookie-less unprefixed administration sign-in", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/admin", {
        headers: { "accept-language": "cs" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/auth/sign-in?returnTo=%2Fadmin"
    );
    expectPrivateAdministrationResponse(response);
  });

  test("redirects cookie-less HEAD requests to the same sign-in continuation", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/invoices?page=2", {
        method: "HEAD",
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/en-US/auth/sign-in?returnTo=%2Fen-US%2Fadmin%2Finvoices%3Fpage%3D2"
    );
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(0);
  });

  test("passes an administration Server Action through without a session cookie", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/discounts", {
        method: "POST",
        headers: { "next-action": "action-id" },
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(0);
  });

  test("passes a session-cookie administration page through with its request path", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/invoices?page=2", {
        headers: { cookie: sessionCookie },
      })
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(
      response.headers.get(
        "x-middleware-request-x-deskohub-administration-path"
      )
    ).toBe("/en-US/admin/invoices?page=2");
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(1);
    expect(administrationRequestHeaders[0]?.get("cookie")).toBe(sessionCookie);
  });

  test("rewrites non-administrators for GET, HEAD, RSC, and unprefixed page requests", async () => {
    administrationAccessResult = "not-administrator";
    const responses: Response[] = [];
    for (const request of [
      new NextRequest(
        "https://workspace.example/cs-CZ/admin/bookings?tab=recent",
        { headers: { cookie: sessionCookie } }
      ),
      new NextRequest("https://workspace.example/cs-CZ/admin/bookings", {
        method: "HEAD",
        headers: { cookie: sessionCookie },
      }),
      new NextRequest("https://workspace.example/cs-CZ/admin/bookings", {
        headers: { cookie: sessionCookie, rsc: "1" },
      }),
      new NextRequest("https://workspace.example/admin", {
        headers: { cookie: sessionCookie, "accept-language": "cs" },
      }),
    ]) {
      responses.push(await proxy(request));
    }

    expect(
      responses.map((response) => response.headers.get("x-middleware-rewrite"))
    ).toEqual([
      "https://workspace.example/cs-CZ/administration-not-found",
      "https://workspace.example/cs-CZ/administration-not-found",
      "https://workspace.example/cs-CZ/administration-not-found",
      "https://workspace.example/cs-CZ/administration-not-found",
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expectPrivateAdministrationResponse(response);
    }
    expect(administrationRequestHeaders).toHaveLength(4);
    expect(administrationRequestHeaders[2]?.get("rsc")).toBe("1");
  });

  test("redirects a stale session cookie to sign-in with its return path", async () => {
    administrationAccessResult = "signed-out";
    const response = await proxy(
      new NextRequest(
        "https://workspace.example/cs-CZ/admin/bookings?tab=recent",
        { headers: { cookie: sessionCookie } }
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/auth/sign-in?returnTo=%2Fcs-CZ%2Fadmin%2Fbookings%3Ftab%3Drecent"
    );
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(1);
    expect(administrationRequestHeaders[0]?.get("cookie")).toBe(sessionCookie);
  });

  test("returns a private unavailable response when the administrator reader rejects", async () => {
    administrationAccessFailure = new Error("synthetic reader failure");
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/bookings", {
        headers: { cookie: sessionCookie },
      })
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(response.headers.get("location")).toBeNull();
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(1);
  });

  test("passes administration Server Actions with a session cookie without reading access", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/discounts", {
        method: "POST",
        headers: { cookie: sessionCookie, "next-action": "action-id" },
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expectPrivateAdministrationResponse(response);
    expect(administrationRequestHeaders).toHaveLength(0);
  });

  test("overwrites a client-sent administration request path header", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin/discounts", {
        headers: {
          cookie: sessionCookie,
          "x-deskohub-administration-path": "/client-supplied",
        },
      })
    );

    expect(
      response.headers.get(
        "x-middleware-request-x-deskohub-administration-path"
      )
    ).toBe("/en-US/admin/discounts");
    expectPrivateAdministrationResponse(response);
  });
});

test("passes Server Action requests through without mutating the response", async () => {
  const request = new NextRequest(
    "https://workspace.example/en-US/checkout/pay",
    {
      method: "POST",
      headers: {
        "next-action": "action-id",
      },
    }
  );

  const response = await proxy(request);

  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.cookies.get(localeCookieName)).toBeUndefined();
});

describe("locale negotiation", () => {
  const localeRedirect = async (url: string, headers: HeadersInit = {}) => {
    const response = await proxy(new NextRequest(url, { headers }));
    return {
      status: response.status,
      location: response.headers.get("location"),
    };
  };

  test("opens Czech for a request that states no language", async () => {
    for (const [path, localized] of [
      ["/", "/cs-CZ"],
      ["/faq?x=1", "/cs-CZ/faq?x=1"],
    ]) {
      expect(await localeRedirect(`https://workspace.example${path}`)).toEqual({
        status: 307,
        location: `https://workspace.example${localized}`,
      });
    }
  });

  test("opens Czech for Slovak readers and English for unserved languages", async () => {
    expect(
      await localeRedirect("https://workspace.example/faq", {
        "accept-language": "sk-SK,sk;q=0.9",
      })
    ).toEqual({ status: 307, location: "https://workspace.example/cs-CZ/faq" });
    expect(
      await localeRedirect("https://workspace.example/faq", {
        "accept-language": "de-DE,de;q=0.9",
      })
    ).toEqual({ status: 307, location: "https://workspace.example/en-US/faq" });
  });

  test("moves a loosely spelled locale prefix permanently to the exact locale", async () => {
    for (const [path, exact] of [
      ["/en-us/faq?x=1", "/en-US/faq?x=1"],
      ["/EN-US", "/en-US"],
      ["/cs-cz/pricing", "/cs-CZ/pricing"],
      ["/en/faq", "/en-US/faq"],
      ["/CS/faq", "/cs-CZ/faq"],
      ["/sk/faq", "/cs-CZ/faq"],
      ["/en/account", "/en-US/account"],
      ["/cs/admin", "/cs-CZ/admin"],
    ]) {
      // The URL alone decides, whatever the visitor's language or cookie.
      expect(
        await localeRedirect(`https://workspace.example${path}`, {
          "accept-language": "de",
          cookie: `${localeCookieName}=en-US`,
        })
      ).toEqual({ status: 308, location: `https://workspace.example${exact}` });
    }
  });

  test("keeps a credential-bearing link's exact-locale redirect private", async () => {
    const response = await proxy(
      new NextRequest(
        `https://workspace.example/en/reservation/access/synthetic-order?${reservationAccessTokenQueryParam}=synthetic-token`
      )
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `https://workspace.example/en-US/reservation/access/synthetic-order?${reservationAccessTokenQueryParam}=synthetic-token`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("dotted paths under a locale prefix", () => {
  const matchesProxy = (pathname: string) =>
    unstable_doesMiddlewareMatch({
      config,
      url: `https://workspace.example${pathname}`,
    });

  test("reach the proxy whatever the prefix's letter case", () => {
    for (const pathname of [
      "/CS-cz/x.txt",
      "/en-us/x.html",
      "/EN-US/a/b.php",
      "/cs-CZ/nope.html",
      "/de-de/x.html",
    ]) {
      expect(matchesProxy(pathname)).toBe(true);
    }
  });

  test("leave root files, build assets and API routes out of the proxy", () => {
    for (const pathname of [
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
      "/.well-known/security.txt",
      indexNowKeyPathname,
      "/favicon.ico",
      "/favicon.png",
      "/apple-touch-icon.png",
      "/manifest.webmanifest",
      "/official-company-extract.pdf",
      "/_next/static/chunks/main.js",
      "/api/v1/cli/file.json",
    ]) {
      expect(matchesProxy(pathname)).toBe(false);
    }
  });

  // Next strips the suffix before the proxy sees the URL, so these requests
  // would pass for page loads.
  test("leave RSC and segment requests under a locale out of the proxy", () => {
    for (const pathname of [
      "/en-US/faq.rsc",
      "/en-us/faq.rsc",
      "/cs-CZ/pricing.prefetch.rsc",
      "/cs-CZ/pricing.segments/_tree.segment.rsc",
      "/en-US/faq.segments/$c$locale/__PAGE__.segment.rsc",
    ]) {
      expect(matchesProxy(pathname)).toBe(false);
    }
  });

  test("move a loosely spelled locale prefix permanently to the exact locale", async () => {
    for (const [path, exact] of [
      ["/CS-cz/x.txt", "/cs-CZ/x.txt"],
      ["/en-us/x.html", "/en-US/x.html"],
      ["/EN-US/a/b.php?x=1", "/en-US/a/b.php?x=1"],
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}`)
      );

      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example${exact}`
      );
    }
  });

  // Under a prefix that names no locale (`/de-de`), the `afterFiles` rewrite
  // in `next.config.mjs` then gives the path the locale redirect.
  test("go on untouched under an exact locale or a prefix that names none", async () => {
    for (const path of [
      "/cs-CZ/nope.html",
      "/en-US/a/b.php",
      "/de-de/x.html",
      "/xx-YY/a.txt",
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}`, {
          headers: { "accept-language": "de" },
        })
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
      expect(response.cookies.get(localeCookieName)).toBeUndefined();
    }
  });
});

test("continues to persist the locale for ordinary localized requests", async () => {
  const request = new NextRequest("https://workspace.example/cs-CZ");

  const response = await proxy(request);

  expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
});

test.each([
  ["cs-CZ,cs;q=0.9,en;q=0.8", "cs-CZ"],
  ["en-US,en;q=0.9", "en-US"],
] as const)(
  "opens an unprefixed referral share link in the visitor's language for %s",
  async (acceptLanguage, locale) => {
    const response = await proxy(
      new NextRequest("https://workspace.example/account?ref=RFL12345", {
        headers: { "accept-language": acceptLanguage },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://workspace.example/${locale}/account?ref=RFL12345`
    );
  }
);

describe("legacy account section links", () => {
  test("redirects a localized ?section= link to the section's path, keeping other parameters", async () => {
    const response = await proxy(
      new NextRequest(
        "https://workspace.example/cs-CZ/account?section=security&utm_source=email"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/account/security?utm_source=email"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
  });

  test("redirects an unknown section to the account itself", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/account?section=unknown")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/en-US/account"
    );
  });

  test("redirects an unprefixed ?section= link straight to the localized section path", async () => {
    const response = await proxy(
      new NextRequest(
        "https://workspace.example/account?section=billing&ref=RFL12345",
        { headers: { "accept-language": "cs-CZ,cs;q=0.9" } }
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/account/billing?ref=RFL12345"
    );
  });

  test("serves section paths and other account pages without a redirect", async () => {
    for (const path of [
      "/en-US/account",
      "/en-US/account/profile",
      "/en-US/account/legal?section=profile",
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}`)
      );

      expect(response.headers.get("location")).toBeNull();
    }
  });
});

test("prevents private reservation responses from being cached", async () => {
  for (const path of [
    "/en-US/reservation/status/reservation-id?outcome=success",
    "/en-US/reservation/access/reservation-id?accessToken=sensitive",
    "/en-US/reservation/invoice/reservation-id?accessToken=sensitive",
  ]) {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`)
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("exchanges a valid reservation capability for a private cookie", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/en-US/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=${encodeURIComponent(accessToken)}`
    )
  );

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))?.value
  ).toEqual(expect.any(String));
});

test("exchanges an access capability with preview bypass params and strips credentials", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const url = new URL(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  url.searchParams.set(reservationAccessTokenQueryParam, accessToken);
  url.searchParams.set(
    "x-vercel-protection-bypass",
    "synthetic-preview-bypass"
  );
  url.searchParams.set("x-vercel-set-bypass-cookie", "true");

  const response = await proxy(new NextRequest(url));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))?.value
  ).toEqual(expect.any(String));
});

test("rejects malformed access preview bypass params without leaking credentials", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const malformedQuery = [
    (url: URL) => url.searchParams.set("redirect", "https://evil.example"),
    (url: URL) => {
      url.searchParams.append("x-vercel-protection-bypass", "synthetic-one");
      url.searchParams.append("x-vercel-protection-bypass", "synthetic-two");
    },
    (url: URL) => {
      url.searchParams.append("x-vercel-set-bypass-cookie", "true");
      url.searchParams.append("x-vercel-set-bypass-cookie", "true");
    },
    (url: URL) => url.searchParams.set("x-vercel-set-bypass-cookie", "false"),
    (url: URL) => url.searchParams.set("outcome", "success"),
  ];

  for (const addMalformedParam of malformedQuery) {
    const url = new URL(
      `https://workspace.example/en-US/reservation/access/${orderId}`
    );
    url.searchParams.set(reservationAccessTokenQueryParam, accessToken);
    addMalformedParam(url);

    const response = await proxy(new NextRequest(url));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(
      response.cookies.get(getReservationAccessCookieName(orderId))
    ).toBeUndefined();
  }
});

test("keeps the legacy reservation capability bound to its issuance locale", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/cs-CZ/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=${encodeURIComponent(accessToken)}`
    )
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))
  ).toBeUndefined();
});

test("rejects invalid reservation capability exchanges without setting a cookie", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/en-US/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=invalid`
    )
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))
  ).toBeUndefined();
});

test("prevents account and auth page responses from being cached", async () => {
  for (const path of [
    "/en-US/account",
    "/en-US/account/deleted",
    "/cs-CZ/account",
    "/en-US/auth/sign-in",
    "/cs-CZ/auth/callback",
  ]) {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`)
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("keeps public pages cacheable while locale switching", async () => {
  const response = await proxy(
    new NextRequest("https://workspace.example/cs-CZ/reservation/cowork")
  );

  expect(response.headers.get("cache-control")).toBeNull();
});

test("does not treat a GET with a spoofed action header as a Server Action", async () => {
  const request = new NextRequest("https://workspace.example/", {
    headers: {
      "next-action": "spoofed-action-id",
    },
  });

  const response = await proxy(request);

  expect(response.headers.get("location")).toBe(
    "https://workspace.example/cs-CZ"
  );
});

test("redirects session-cookie unprefixed administration URLs to the resolved locale with query", async () => {
  const cases = [
    {
      url: "https://workspace.example/admin/cli/authenticate?code=SYNTHETIC-CODE",
      headers: {},
      location:
        "https://workspace.example/cs-CZ/admin/cli/authenticate?code=SYNTHETIC-CODE",
    },
    {
      url: "https://workspace.example/admin",
      headers: { "accept-language": "cs-CZ,cs;q=0.9" },
      location: "https://workspace.example/cs-CZ/admin",
    },
    {
      url: "https://workspace.example/admin/reservations?status=paid",
      headers: { cookie: `${localeCookieName}=cs-CZ` },
      location:
        "https://workspace.example/cs-CZ/admin/reservations?status=paid",
    },
  ];

  for (const { url, headers, location } of cases) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set(
      "cookie",
      [sessionCookie, requestHeaders.get("cookie")]
        .filter((value): value is string => value !== null)
        .join("; ")
    );
    const response = await proxy(
      new NextRequest(url, {
        headers: requestHeaders,
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(location);
    expectPrivateAdministrationResponse(response);
  }
});

test.each([
  ["signed out", {}],
  ["signed in", { cookie: sessionCookie }],
])(
  "redirects the OAuth server's AI assistant pages to the locale with their signed query intact while %s",
  async (_label, headers) => {
    // The provider's signed query, with encoded values and a repeated key.
    const query =
      "?response_type=code&client_id=https%3A%2F%2Fassistant.invalid%2Fclient.json&scope=offerings%3Aread+reservations%3Aread&state=a%2Fb%3Dc&exp=1900000000&ba_iat=1899999400&ba_param=client_id&ba_param=scope&sig=SYNTHETIC-SIG_-";
    for (const path of ["/auth/connect", "/auth/consent"]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}${query}`, {
          headers: { ...headers, "accept-language": "cs-CZ,cs;q=0.9" },
        })
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example/cs-CZ${path}${query}`
      );
    }
  }
);

describe("AI assistant sign-in step", () => {
  const signedQuery =
    "?response_type=code&client_id=https%3A%2F%2Fassistant.invalid%2Fclient.json&scope=reservations%3Aread&state=s&exp=1900000000&ba_iat=1899999400&ba_param=client_id&sig=SYNTHETIC-SIG_-";

  test("sends a signed-out page load to the assistant sign-in with an HTTP redirect", async () => {
    const response = await proxy(
      new NextRequest(
        `https://workspace.example/en-US/auth/connect${signedQuery}`
      )
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/en-US/auth/sign-in");
    expect(location.searchParams.get("for")).toBe("assistant");
    const returnTo = new URL(
      location.searchParams.get("returnTo")!,
      "https://workspace.example"
    );
    expect(returnTo.pathname).toBe("/en-US/auth/connect");
    expect(returnTo.searchParams.get("client_id")).toBe(
      "https://assistant.invalid/client.json"
    );
    expect(returnTo.searchParams.has("sig")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test.each([
    [
      "a signed-in visitor",
      `/en-US/auth/connect${signedQuery}`,
      { cookie: sessionCookie },
    ],
    ["a request without a client", "/en-US/auth/connect", {}],
  ])("leaves %s to the page", async (_label, path, headers) => {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`, { headers })
    );

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("account render pathname hand-off", () => {
  const renderedPathname = (response: Response) =>
    response.headers.get("x-middleware-request-x-deskohub-request-pathname");

  const matchesProxy = (pathname: string) =>
    unstable_doesMiddlewareMatch({
      config,
      url: `https://workspace.example${pathname}`,
    });

  test("matches every account route including dotted segments", () => {
    for (const pathname of [
      "/account",
      "/account/security",
      "/account/unknown.foo",
      "/en-US/account",
      "/en-US/account/unknown.foo",
      "/en-US/account/x.png",
      "/cs-CZ/account/security.",
      "/en-US/account/legal/terms.pdf",
    ]) {
      expect(matchesProxy(pathname)).toBe(true);
    }
  });

  test("keeps API routes and static files out of the proxy", () => {
    for (const pathname of [
      "/api/account/customer-link",
      "/api/account/customer.link",
      "/_next/static/chunks/account.js",
      "/favicon.ico",
      "/workspace-location-map.jpeg",
      // The footer's company extract and the utility files serve from the
      // site root, without a locale prefix.
      "/official-company-extract.pdf",
      "/llms.txt",
      "/.well-known/security.txt",
      indexNowKeyPathname,
    ]) {
      expect(matchesProxy(pathname)).toBe(false);
    }
  });

  test("hands account renders their pathname, replacing a client's value", async () => {
    for (const path of [
      "/en-US/account",
      "/en-US/account/unknown",
      "/en-US/account/unknown.foo",
      "/cs-CZ/account/security",
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}`, {
          headers: { "x-deskohub-request-pathname": "/en-US/account" },
        })
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(renderedPathname(response)).toBe(path);
    }
  });

  test("hands an account Server Action's render its pathname", async () => {
    for (const path of ["/en-US/account/danger", "/en-US/account/danger.x"]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${path}`, {
          method: "POST",
          headers: {
            "next-action": "action-id",
            "x-deskohub-request-pathname": "/en-US/account",
          },
        })
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(renderedPathname(response)).toBe(path);
      expect(response.cookies.get(localeCookieName)).toBeUndefined();
    }
  });

  test("leaves other renders' request headers alone", async () => {
    for (const request of [
      new NextRequest("https://workspace.example/en-US/reservation/cowork"),
      new NextRequest("https://workspace.example/en-US/checkout/pay", {
        method: "POST",
        headers: { "next-action": "action-id" },
      }),
    ]) {
      const response = await proxy(request);

      expect(response.headers.get("x-middleware-override-headers")).toBeNull();
    }
  });
});

describe("shared referral code hand-off", () => {
  const storedCookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${referralCodeCookieName}=`));
  const renderedCookies = (response: Response) =>
    response.headers.get("x-middleware-request-cookie");

  test("hands a shared code to the page's own render without storing it", async () => {
    const response = await proxy(
      new NextRequest(
        "https://workspace.example/cs-CZ/reservation/cowork?ref=RFL12345"
      )
    );

    // The proxy cannot read the referrals flag, so only the gated page
    // remembers the code; the render's gated reader sees it meanwhile.
    expect(storedCookieOf(response)).toBeUndefined();
    expect(renderedCookies(response)).toContain(
      `${referralCodeCookieName}=RFL12345`
    );
  });

  test("normalizes the code's case", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/en-US/account?ref=rfl12345")
    );

    expect(renderedCookies(response)).toContain(
      `${referralCodeCookieName}=RFL12345`
    );
  });

  test("keeps the first shared code when one is already remembered", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/account?ref=RFLSECOND", {
        headers: { cookie: `${referralCodeCookieName}=RFLFIRST1` },
      })
    );

    expect(storedCookieOf(response)).toBeUndefined();
    // The account render receives the request's own cookies, unchanged.
    expect(renderedCookies(response)).toBe(
      `${referralCodeCookieName}=RFLFIRST1`
    );
  });

  test("ignores a value that cannot be a referral code", async () => {
    for (const value of ["", "a", "bad code!", "x".repeat(80)]) {
      const response = await proxy(
        new NextRequest(
          `https://workspace.example/en-US/account?ref=${encodeURIComponent(value)}`
        )
      );
      expect(renderedCookies(response)).toBeNull();
    }
  });

  test.each(
    (
      [
        ["HEAD", { method: "HEAD", headers: {} }],
        ["a non-action POST", { method: "POST", headers: {} }],
        ["an RSC request", { headers: { rsc: "1" } }],
        ["a router prefetch", { headers: { "next-router-prefetch": "1" } }],
        [
          "a segment prefetch",
          { headers: { "next-router-segment-prefetch": "/_tree" } },
        ],
        [
          "a router state request",
          { headers: { "next-router-state-tree": "%5B%22%22%5D" } },
        ],
        ["a speculative prefetch", { headers: { "sec-purpose": "prefetch" } }],
        [
          "a speculative prerender",
          { headers: { "sec-purpose": "prefetch;prerender" } },
        ],
        ["a legacy prefetch", { headers: { purpose: "prefetch" } }],
        ["a subresource fetch", { headers: { "sec-fetch-dest": "empty" } }],
        ["an iframe load", { headers: { "sec-fetch-dest": "iframe" } }],
        [
          "a Server Action",
          { method: "POST", headers: { "next-action": "synthetic-action" } },
        ],
      ] as const
    ).map(([kind, init]) => [kind, init] as const)
  )("never hands a code to %s", async (_kind, init) => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/account?ref=RFL12345", {
        ...init,
        headers: { "accept-language": "en-US", ...init.headers },
      })
    );

    expect(storedCookieOf(response)).toBeUndefined();
    expect(renderedCookies(response)).toBeNull();
  });

  test("hands a code to a top-level document navigation", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/account?ref=RFL12345", {
        headers: {
          "accept-language": "en-US",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      })
    );

    expect(renderedCookies(response)).toContain(
      `${referralCodeCookieName}=RFL12345`
    );
    expect(storedCookieOf(response)).toBeUndefined();
  });
});

describe("agent traffic", () => {
  const chatGptUser =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot";
  const chromeOnMac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

  test("records an agent page load once", async () => {
    const response = await proxy(
      new NextRequest(
        "https://workspace.example/en-US/reservation/status/019edbcf-5026-7ecc-821b-eda46998eaaa?statusToken=synthetic",
        { headers: { "user-agent": chatGptUser, "sec-fetch-dest": "document" } }
      )
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(scheduledAgentPageRequests).toEqual([
      {
        traffic: { category: "ai_user_agent", name: "chatgpt" },
        locale: "en-US",
        pathname:
          "/en-US/reservation/status/019edbcf-5026-7ecc-821b-eda46998eaaa",
      },
    ]);
  });

  test("records nothing for a human page load", async () => {
    await proxy(
      new NextRequest("https://workspace.example/en-US/reservation/cowork", {
        headers: { "user-agent": chromeOnMac, "sec-fetch-dest": "document" },
      })
    );

    expect(scheduledAgentPageRequests).toEqual([]);
  });

  test("ignores a client-sent category on a human page load", async () => {
    await proxy(
      new NextRequest("https://workspace.example/en-US/reservation/cowork", {
        headers: {
          "user-agent": chromeOnMac,
          "sec-fetch-dest": "document",
          "x-deskohub-agent-category": "ai_user_agent",
          "x-deskohub-agent-name": "claude",
        },
      })
    );

    expect(scheduledAgentPageRequests).toEqual([]);
  });

  test("records no page load for an agent's Server Action", async () => {
    await proxy(
      new NextRequest("https://workspace.example/en-US/checkout/pay", {
        method: "POST",
        headers: { "next-action": "action-id", "user-agent": chatGptUser },
      })
    );

    expect(scheduledAgentPageRequests).toEqual([]);
  });

  test.each([
    ["a router request", { rsc: "1" }],
    ["a router prefetch", { "next-router-prefetch": "1" }],
    ["a speculative prefetch", { "sec-purpose": "prefetch" }],
    ["a subresource load", { "sec-fetch-dest": "image" }],
  ])("records nothing for %s", async (_, headers) => {
    await proxy(
      new NextRequest("https://workspace.example/en-US/reservation/cowork", {
        headers: { "user-agent": chatGptUser, ...headers },
      })
    );

    expect(scheduledAgentPageRequests).toEqual([]);
  });

  test("records nothing for a redirect to the localized page", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/reservation/cowork", {
        headers: { "user-agent": chatGptUser, "accept-language": "en-US" },
      })
    );

    expect(response.status).toBe(307);
    expect(scheduledAgentPageRequests).toEqual([]);
  });
});

describe("page Markdown negotiation", () => {
  const markdownAccept = "text/markdown, text/html;q=0.9, */*;q=0.8";
  const browserAccept =
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
  const varyOf = (response: Response) =>
    (response.headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase());

  test.each([
    ["/en-US", "/page-markdown/en-US"],
    ["/cs-CZ/contact", "/page-markdown/cs-CZ/contact"],
    [
      "/en-US/terms-and-conditions",
      "/page-markdown/en-US/terms-and-conditions",
    ],
    ["/cs-CZ/reservation/cowork", "/page-markdown/cs-CZ/reservation/cowork"],
  ])(
    "rewrites a public page %s that prefers Markdown to %s",
    async (pathname, routePath) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await proxy(
          new NextRequest(`https://workspace.example${pathname}`, {
            method,
            headers: { accept: markdownAccept },
          })
        );

        expect(response.headers.get("x-middleware-rewrite")).toBe(
          `https://workspace.example${routePath}`
        );
        expect(response.headers.get("location")).toBeNull();
      }
    }
  );

  test.each([
    ["a browser", browserAccept],
    ["any type", "*/*"],
    ["no preference", undefined],
    ["HTML first at equal quality", "text/html, text/markdown"],
    ["Markdown at a lower quality", "text/markdown;q=0.5, text/html"],
  ])("serves the HTML page to %s, varying on Accept", async (_, accept) => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/faq", {
        headers: accept === undefined ? {} : { accept },
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(varyOf(response)).toContain("accept");
  });

  test("redirects an unprefixed page to its locale before negotiating", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/contact", {
        headers: { accept: markdownAccept, "accept-language": "cs" },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://workspace.example/cs-CZ/contact"
    );
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test.each([
    "/en-US/account",
    "/en-US/checkout/pay?state=synthetic",
    "/en-US/reservation/status/019edbcf-5026-7ecc-821b-eda46998eaaa",
    "/en-US/logo",
    "/en-US/cookie-settings",
    "/en-US/testing",
    "/en-US/unknown-page",
  ])("never rewrites %s, which is not a public page", async (path) => {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`, {
        headers: { accept: "text/markdown" },
      })
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(varyOf(response)).not.toContain("accept");
  });

  test("never rewrites the administration", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/admin", {
        headers: { accept: "text/markdown" },
      })
    );

    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain(
      "/page-markdown"
    );
  });

  test("passes a Server Action on a public page through", async () => {
    const response = await proxy(
      new NextRequest("https://workspace.example/en-US/contact", {
        method: "POST",
        headers: { accept: "text/markdown", "next-action": "action-id" },
      })
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  test("records an agent's Markdown page load", async () => {
    await proxy(
      new NextRequest("https://workspace.example/en-US/faq", {
        headers: {
          accept: "text/markdown",
          "user-agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
        },
      })
    );

    expect(scheduledAgentPageRequests).toEqual([
      {
        traffic: { category: "ai_user_agent", name: "chatgpt" },
        locale: "en-US",
        pathname: "/en-US/faq",
      },
    ]);
  });
});

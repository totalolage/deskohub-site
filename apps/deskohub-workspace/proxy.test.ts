import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { referralCodeCookieName } from "@/features/referrals/referral-code-cookie";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import { runCommand } from "@/scripts/shared/command";
import { workspaceTestAdministrators } from "@/shared/testing/workspace-test-environment";
import { config, proxy } from "./proxy";

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

test("retains Development and Production payment origins", async () => {
  const results = await Promise.all(
    (["development", "production"] as const).map(inspectCheckoutEntryOnce)
  );
  for (const result of results) {
    expect(result.exitCode).toBe(0);
    const responses = inspectedResponses(result);
    for (const index of [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(responses[index].location).toBeNull();
    }
  }
});

const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const [primaryAdministrator, secondaryAdministrator] =
  workspaceTestAdministrators;
const primaryAdminAuthorization = toAuthorization(
  primaryAdministrator.username,
  primaryAdministrator.password
);
const secondaryAdminAuthorization = toAuthorization(
  secondaryAdministrator.username,
  secondaryAdministrator.password
);

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

      expect(response.status).not.toBe(401);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example/en-US${pathname}`
      );
    }
  });

  test("challenges every concrete administration route", async () => {
    for (const pathname of administrationPaths) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        "Basic realm="
      );
    }
  });

  test("challenges every spelling of an administration URL", async () => {
    for (const pathname of [
      "/xx-XX/admin",
      "/cs-cz/admin/reservations",
      "/%61dmin/reservations",
      "/cs-CZ/%61dmin",
      "/en-US/admin%2Freservations",
    ]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(401);
    }
  });

  test("challenges navigation request variants consistently", async () => {
    const requests = [
      new NextRequest("https://workspace.example/admin/reservations", {
        method: "HEAD",
      }),
      new NextRequest("https://workspace.example/admin/reservations", {
        headers: { rsc: "1" },
      }),
      new NextRequest("https://workspace.example/admin/reservations", {
        headers: {
          "next-router-prefetch": "1",
          purpose: "prefetch",
        },
      }),
    ];

    for (const request of requests) {
      expect((await proxy(request)).status).toBe(401);
    }
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
    "https://workspace.example/en-US"
  );
});

test("challenges unauthenticated administration requests", async () => {
  const response = await proxy(
    new NextRequest("https://workspace.example/admin/discounts")
  );

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Basic realm=");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
});

test("passes authenticated localized administration requests", async () => {
  for (const authorization of [
    primaryAdminAuthorization,
    secondaryAdminAuthorization,
  ]) {
    for (const locale of ["en-US", "cs-CZ"]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example/${locale}/admin/discounts`, {
          headers: { authorization },
        })
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Authorization");
      expect(response.cookies.get(localeCookieName)?.value).toBe(locale);
    }
  }
});

test("redirects authenticated unprefixed administration URLs to the resolved locale", async () => {
  const cases = [
    {
      url: "https://workspace.example/admin/cli/authenticate?code=SYNTHETIC-CODE",
      headers: {},
      location:
        "https://workspace.example/en-US/admin/cli/authenticate?code=SYNTHETIC-CODE",
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
    const response = await proxy(
      new NextRequest(url, {
        headers: { ...headers, authorization: primaryAdminAuthorization },
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(location);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept-Language, Authorization");
  }
});

test("fails closed for wrong, crossed, and unknown administrator credentials", async () => {
  for (const authorization of [
    toAuthorization("admin", "operator-test-password"),
    toAuthorization("operator", "test-password"),
    toAuthorization("admin", "definitely-not-the-password"),
    toAuthorization("unknown", "test-password"),
  ]) {
    const response = await proxy(
      new NextRequest("https://workspace.example/admin/discounts", {
        headers: { authorization },
      })
    );

    expect(response.status).toBe(401);
  }
});

test("checks administration Server Action posts before the general pass-through", async () => {
  for (const pathname of ["/admin/discounts", "/cs-CZ/admin/discounts"]) {
    const unauthorized = await proxy(
      new NextRequest(`https://workspace.example${pathname}`, {
        method: "POST",
        headers: { "next-action": "action-id" },
      })
    );
    const authorized = await proxy(
      new NextRequest(`https://workspace.example${pathname}`, {
        method: "POST",
        headers: {
          authorization: primaryAdminAuthorization,
          "next-action": "action-id",
        },
      })
    );

    expect(unauthorized.status).toBe(401);
    expect(authorized.headers.get("x-middleware-next")).toBe("1");
    expect(authorized.headers.get("cache-control")).toBe("private, no-store");
  }
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
    expect(renderedCookies(response)).toBeNull();
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

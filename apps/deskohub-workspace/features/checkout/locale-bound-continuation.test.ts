import { describe, expect, test } from "bun:test";
import { Effect, Logger } from "effect";
import {
  findLocaleBoundContinuation,
  type LocaleBoundContinuation,
  preferenceApplyingTo,
} from "./locale-bound-continuation";

const payUrl = new URL(
  "https://workspace.example/en-US/checkout/pay?payState=x"
);

const apply = async (
  ...args: Parameters<typeof preferenceApplyingTo<unknown>>
) => {
  const warnings: unknown[] = [];
  const captureLogger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push(options.message);
  });
  const applied = await preferenceApplyingTo(...args).pipe(
    Effect.provide(Logger.layer([captureLogger])),
    Effect.runPromise
  );
  return { applied, warnings };
};

describe("preferenceApplyingTo", () => {
  test.each([
    {
      name: "throws",
      verify: (): Effect.Effect<boolean> => {
        throw new Error("synthetic import failure");
      },
    },
    {
      name: "fails",
      verify: () => Effect.fail(new Error("synthetic runtime failure")),
    },
    {
      name: "dies",
      verify: () => Effect.die(new Error("synthetic verifier defect")),
    },
  ])(
    "applies the preference and logs once when the verifier $name",
    async ({ verify }) => {
      const { applied, warnings } = await apply(payUrl, "cs-CZ", verify);

      expect(applied).toBe("cs-CZ");
      expect(warnings).toHaveLength(1);
    }
  );

  test("keeps the issued locale only for a verified continuation", async () => {
    expect(
      (await apply(payUrl, "cs-CZ", () => Effect.succeed(true))).applied
    ).toBeUndefined();
    expect(
      (await apply(payUrl, "cs-CZ", () => Effect.succeed(false))).applied
    ).toBe("cs-CZ");
  });

  test("never verifies for a guest, a matching locale, or an unknown page", async () => {
    const verified: LocaleBoundContinuation[] = [];
    const verify = (continuation: LocaleBoundContinuation) => {
      verified.push(continuation);
      return Effect.succeed(true);
    };

    expect((await apply(payUrl, undefined, verify)).applied).toBeUndefined();
    expect((await apply(payUrl, "en-US", verify)).applied).toBe("en-US");
    expect((await apply(undefined, "cs-CZ", verify)).applied).toBe("cs-CZ");
    expect(verified).toEqual([]);
  });
});

const continuationAt = (href: string) => {
  const url = new URL(href, "https://workspace.example");
  return findLocaleBoundContinuation({
    pathname: url.pathname,
    searchParams: url.searchParams,
  });
};

describe("findLocaleBoundContinuation", () => {
  test("finds a Pay state on the Pay page", () => {
    expect(continuationAt("/cs-CZ/checkout/pay?payState=t")).toEqual({
      kind: "pay-state",
      locale: "cs-CZ",
      token: "t",
    });
  });

  test.each([
    ["/reservation/cowork", "cowork"],
    ["/reservation/meeting-room", "meeting-room"],
    ["/reservation/office", "office"],
  ] as const)("finds a Pay state on the %s restoration page", (route, kind) => {
    expect(continuationAt(`/en-US${route}?payState=t`)).toEqual({
      kind: "pay-state",
      locale: "en-US",
      reservationKind: kind,
      token: "t",
    });
  });

  test("finds an access token on a single-segment invoice page", () => {
    expect(
      continuationAt("/en-US/reservation/invoice/order-1?accessToken=a")
    ).toEqual({
      kind: "reservation-invoice",
      locale: "en-US",
      orderId: "order-1",
      token: "a",
    });
  });

  test("prefers the invoice token when a Pay state reaches the invoice page", () => {
    expect(
      continuationAt(
        "/en-US/reservation/invoice/order-1?payState=t&accessToken=a"
      )?.kind
    ).toBe("reservation-invoice");
  });

  test.each([
    ["an unlocalized path", "/checkout/pay?payState=t"],
    ["an empty Pay state", "/en-US/checkout/pay?payState="],
    ["a Pay state on another page", "/en-US/faq?payState=t"],
    ["an access token on the Pay page", "/en-US/checkout/pay?accessToken=a"],
    ["an invoice page without a token", "/en-US/reservation/invoice/order-1"],
    ["the invoice index", "/en-US/reservation/invoice/?accessToken=a"],
    [
      "a nested invoice path",
      "/en-US/reservation/invoice/order-1/extra?accessToken=a",
    ],
    ["the bare invoice route", "/en-US/reservation/invoice?accessToken=a"],
  ])("finds nothing for %s", (_name, href) => {
    expect(continuationAt(href)).toBeUndefined();
  });
});

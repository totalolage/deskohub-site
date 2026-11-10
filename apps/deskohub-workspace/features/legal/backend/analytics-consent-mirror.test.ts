import { beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import {
  type AnalyticsConsentDecisionRecord,
  AnalyticsConsentLedger,
  type AnalyticsConsentMirrorRecord,
} from "./analytics-consent-ledger";
import {
  mirrorDeviceAnalyticsConsent,
  recordBannerAnalyticsConsent,
  recordSignedInDeviceAnalyticsConsent,
  resolveSilentAnalyticsGrant,
} from "./analytics-consent-mirror";

const accountId = customerAccountIdSchema.make("analytics-mirror-account");

type CurrentDecision = Effect.Success<
  ReturnType<AnalyticsConsentLedger["Service"]["currentDecision"]>
>;

let mirrored: AnalyticsConsentMirrorRecord[] = [];
let recorded: AnalyticsConsentDecisionRecord[] = [];
let currentDecision: CurrentDecision = Option.none();
/** Whether the ledger takes a mirrored choice, as its ordering rule decides. */
let mirrorTakes = true;
const recordedAt = Temporal.Instant.from("2026-11-08T10:00:00.123456Z");

const ledger = Layer.succeed(AnalyticsConsentLedger, {
  record: (input) =>
    Effect.sync(() => {
      recorded.push(input);
      return recordedAt;
    }),
  mirror: (input) =>
    Effect.sync(() => {
      mirrored.push(input);
      return mirrorTakes;
    }),
  currentDecision: () => Effect.sync(() => currentDecision),
});

beforeEach(() => {
  mirrored = [];
  recorded = [];
  currentDecision = Option.none();
  mirrorTakes = true;
});

/** A consent cookie as the banner saves it, under the current revision by default. */
const consentCookie = (value: {
  readonly categories: readonly string[];
  readonly revision?: number;
  readonly lastConsentTimestamp?: string;
  readonly languageCode?: string;
}) =>
  `theme=dark; cc_cookie=${encodeURIComponent(
    JSON.stringify({ revision: getConsentBannerRevision(), ...value })
  )}`;

// A choice saved before the banner was bound to the legal documents.
const preBindingCookie = consentCookie({
  categories: ["necessary", "analytics"],
  revision: 0,
  lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
});

const device = (cookieHeader: string) => ({
  accountId,
  cookieHeader,
  locale: "cs-CZ" as const,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, AnalyticsConsentLedger>
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(ledger)));

/** The mirrored records with their dates as strings. */
const mirroredRecords = () =>
  mirrored.map(({ decidedAt, ...record }) => ({
    ...record,
    decidedAt: Option.getOrUndefined(Option.map(decidedAt, String)),
  }));

describe("mirrorDeviceAnalyticsConsent", () => {
  test("mirrors an accepted analytics category as a grant dated at the cookie's last save, in its banner language", async () => {
    await run(
      mirrorDeviceAnalyticsConsent({
        ...device(
          consentCookie({
            categories: ["necessary", "analytics"],
            lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
            languageCode: "en-US",
          })
        ),
        source: "sign_in_mirror",
      })
    );

    expect(mirroredRecords()).toEqual([
      {
        accountId,
        decision: "grant",
        locale: "en-US",
        source: "sign_in_mirror",
        decidedAt: "2026-11-02T09:30:00Z",
      },
    ]);
  });

  test("mirrors a declined analytics category as a withdrawal", async () => {
    await run(
      mirrorDeviceAnalyticsConsent({
        ...device(consentCookie({ categories: ["necessary", "marketing"] })),
        source: "hydration_mirror",
      })
    );

    expect(mirroredRecords()).toEqual([
      {
        accountId,
        decision: "withdraw",
        locale: "cs-CZ",
        source: "hydration_mirror",
        decidedAt: undefined,
      },
    ]);
  });

  test("falls back to the request locale when the banner language is no site locale", async () => {
    await run(
      mirrorDeviceAnalyticsConsent({
        ...device(
          consentCookie({ categories: ["necessary"], languageCode: "de" })
        ),
        source: "hydration_mirror",
      })
    );

    expect(mirrored.map(({ locale }) => locale)).toEqual(["cs-CZ"]);
  });

  test("mirrors nothing without a saved choice, with a malformed one, or with one saved under an earlier banner revision", async () => {
    for (const cookieHeader of [
      "",
      "theme=dark",
      "cc_cookie=",
      `cc_cookie=${encodeURIComponent("{")}`,
      preBindingCookie,
      `cc_cookie=${encodeURIComponent(
        JSON.stringify({ categories: ["necessary", "analytics"] })
      )}`,
    ]) {
      expect(
        await run(
          mirrorDeviceAnalyticsConsent({
            ...device(cookieHeader),
            source: "sign_in_mirror",
          })
        )
      ).toBe(false);
    }
    expect(mirrored).toEqual([]);
  });
});

describe("recordBannerAnalyticsConsent", () => {
  test("records the saved choice as a banner decision made now", async () => {
    expect(
      await run(
        recordBannerAnalyticsConsent(
          device(
            consentCookie({
              categories: ["necessary", "analytics"],
              lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
              languageCode: "cs-CZ",
            })
          )
        )
      )
    ).toBe(true);

    expect(recorded).toEqual([
      { accountId, decision: "grant", locale: "cs-CZ", source: "banner" },
    ]);
  });

  test("records nothing without a saved choice under the current revision", async () => {
    expect(await run(recordBannerAnalyticsConsent(device("")))).toBe(false);
    expect(
      await run(recordBannerAnalyticsConsent(device(preBindingCookie)))
    ).toBe(false);
    expect(recorded).toEqual([]);
  });
});

describe("recordSignedInDeviceAnalyticsConsent", () => {
  const savedChoice = consentCookie({
    categories: ["necessary", "analytics"],
    lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
  });

  const runSignedIn = (
    occasion: "hydration" | "banner_save",
    session: {
      readonly accountId: CustomerAccountId;
      readonly deletionRequested: boolean;
    } | null,
    cookieHeader = savedChoice
  ) =>
    run(
      recordSignedInDeviceAnalyticsConsent({ occasion, locale: "cs-CZ" }).pipe(
        Effect.map(Option.map(String)),
        Effect.map(Option.getOrUndefined),
        Effect.provideService(
          CurrentWorkspaceRequestHeaders,
          new Headers({ cookie: cookieHeader })
        ),
        Effect.provide(
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed(
              session && {
                ...session,
                ...testSessionProfile,
                email: testEmailAddress("mirror"),
              }
            ),
          })
        )
      )
    );

  const signedIn = { accountId, deletionRequested: false };

  /** The account's current decision, made at the instant. */
  const decidedAt = (
    decision: "grant" | "withdraw",
    at: string
  ): CurrentDecision =>
    Option.some({
      decision,
      documentHash: getLegalDocumentVersion("cs-CZ", "privacy-policy"),
      locale: "cs-CZ",
      decidedAt: Temporal.Instant.from(at),
      source: "preference",
    });

  test("mirrors the request's saved choice for the session's account on hydration", async () => {
    await runSignedIn("hydration", signedIn);

    expect(mirroredRecords()).toEqual([
      {
        accountId,
        decision: "grant",
        locale: "cs-CZ",
        source: "hydration_mirror",
        decidedAt: "2026-11-02T09:30:00Z",
      },
    ]);
    expect(recorded).toEqual([]);
  });

  test("records a banner save as a decision made now", async () => {
    await runSignedIn("banner_save", signedIn);

    expect(recorded).toEqual([
      { accountId, decision: "grant", locale: "cs-CZ", source: "banner" },
    ]);
    expect(mirrored).toEqual([]);
  });

  test("records nothing when signed out or while the account is being deleted", async () => {
    currentDecision = decidedAt("withdraw", "2026-11-05T10:00:00.123456Z");
    mirrorTakes = false;

    for (const occasion of ["hydration", "banner_save"] as const) {
      expect(await runSignedIn(occasion, null)).toBeUndefined();
      expect(
        await runSignedIn(occasion, { accountId, deletionRequested: true })
      ).toBeUndefined();
    }
    expect(mirrored).toEqual([]);
    expect(recorded).toEqual([]);
  });

  describe("propagating the account's withdrawal on hydration", () => {
    const withdrawnAt = "2026-11-05T10:00:00.123456Z";

    test("an accepting device takes the account's newer withdrawal, at its instant", async () => {
      currentDecision = decidedAt("withdraw", withdrawnAt);
      mirrorTakes = false;

      expect(await runSignedIn("hydration", signedIn)).toBe(withdrawnAt);
      expect(mirrored.map(({ decision }) => decision)).toEqual(["grant"]);
    });

    test("an accepting device whose choice is dated at the withdrawal's instant takes the withdrawal", async () => {
      // The ledger never takes a same-instant copy over a recorded decision.
      currentDecision = decidedAt("withdraw", "2026-11-02T09:30:00Z");
      mirrorTakes = false;

      expect(await runSignedIn("hydration", signedIn)).toBe(
        "2026-11-02T09:30:00Z"
      );
    });

    test("an accepting device whose choice is undated takes the account's withdrawal", async () => {
      currentDecision = decidedAt("withdraw", withdrawnAt);
      mirrorTakes = false;

      expect(
        await runSignedIn(
          "hydration",
          signedIn,
          consentCookie({ categories: ["necessary", "analytics"] })
        )
      ).toBe(withdrawnAt);
    });

    test("a device choice newer than the withdrawal is mirrored as a grant and takes nothing", async () => {
      currentDecision = decidedAt("withdraw", "2026-11-01T10:00:00Z");
      mirrorTakes = true;

      expect(await runSignedIn("hydration", signedIn)).toBeUndefined();
      expect(mirroredRecords()).toEqual([
        {
          accountId,
          decision: "grant",
          locale: "cs-CZ",
          source: "hydration_mirror",
          decidedAt: "2026-11-02T09:30:00Z",
        },
      ]);
    });

    test("a device takes nothing when the account never decided or its current decision is a grant", async () => {
      mirrorTakes = false;

      for (const current of [Option.none(), decidedAt("grant", withdrawnAt)]) {
        currentDecision = current;
        expect(await runSignedIn("hydration", signedIn)).toBeUndefined();
      }
    });

    test("a device that declines analytics, or holds no saved choice, takes nothing", async () => {
      currentDecision = decidedAt("withdraw", withdrawnAt);
      mirrorTakes = false;

      for (const cookieHeader of [
        consentCookie({
          categories: ["necessary"],
          lastConsentTimestamp: "2026-11-02T09:30:00.000Z",
        }),
        preBindingCookie,
        "theme=dark",
      ]) {
        expect(
          await runSignedIn("hydration", signedIn, cookieHeader)
        ).toBeUndefined();
      }
    });

    test("a banner save takes nothing", async () => {
      currentDecision = decidedAt("withdraw", withdrawnAt);
      mirrorTakes = false;

      expect(await runSignedIn("banner_save", signedIn)).toBeUndefined();
      expect(recorded.map(({ source }) => source)).toEqual(["banner"]);
    });
  });
});

describe("resolveSilentAnalyticsGrant", () => {
  const grantedAt = Temporal.Instant.from("2026-11-02T09:30:00.123456Z");
  const decision = (
    overrides: Partial<NonNullable<Option.Option.Value<CurrentDecision>>>
  ): CurrentDecision =>
    Option.some({
      decision: "grant",
      documentHash: getLegalDocumentVersion("cs-CZ", "privacy-policy"),
      locale: "cs-CZ",
      decidedAt: grantedAt,
      source: "banner",
      ...overrides,
    });

  const resolve = (
    cookieHeader: string,
    session: {
      readonly accountId: CustomerAccountId;
      readonly deletionRequested: boolean;
    } | null = { accountId, deletionRequested: false }
  ) =>
    run(
      resolveSilentAnalyticsGrant().pipe(
        Effect.map(Option.map(String)),
        Effect.map(Option.getOrUndefined),
        Effect.provideService(
          CurrentWorkspaceRequestHeaders,
          new Headers({ cookie: cookieHeader })
        ),
        Effect.provide(
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed(
              session && {
                ...session,
                ...testSessionProfile,
                email: testEmailAddress("silent"),
              }
            ),
          })
        )
      )
    );

  test("a device without a consent cookie takes the account's grant for the current notice, at the grant's instant", async () => {
    currentDecision = decision({});

    expect(await resolve("theme=dark")).toBe(String(grantedAt));
    expect(mirrored).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test("a withdrawal, a grant for an earlier notice, or no decision gives no silent grant", async () => {
    for (const current of [
      decision({ decision: "withdraw" }),
      decision({ documentHash: "an-earlier-privacy-notice" }),
      decision({ locale: "en-US" }),
      Option.none(),
    ]) {
      currentDecision = current;
      expect(await resolve("theme=dark")).toBeUndefined();
    }
  });

  test("a device holding a consent cookie, even one from an earlier revision, is asked again instead", async () => {
    currentDecision = decision({});

    for (const cookieHeader of [
      preBindingCookie,
      consentCookie({ categories: ["necessary"] }),
      "cc_cookie=",
    ]) {
      expect(await resolve(cookieHeader)).toBeUndefined();
    }
  });

  test("a signed-out request or an account being deleted gives no silent grant", async () => {
    currentDecision = decision({});

    expect(await resolve("theme=dark", null)).toBeUndefined();
    expect(
      await resolve("theme=dark", { accountId, deletionRequested: true })
    ).toBeUndefined();
  });
});

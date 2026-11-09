import { beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
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

const ledger = Layer.succeed(AnalyticsConsentLedger, {
  record: (input) => Effect.sync(() => void recorded.push(input)),
  mirror: (input) => Effect.sync(() => mirrored.push(input) > 0),
  currentDecision: () => Effect.sync(() => currentDecision),
});

beforeEach(() => {
  mirrored = [];
  recorded = [];
  currentDecision = Option.none();
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
    } | null
  ) =>
    run(
      recordSignedInDeviceAnalyticsConsent({ occasion, locale: "cs-CZ" }).pipe(
        Effect.provideService(
          CurrentWorkspaceRequestHeaders,
          new Headers({ cookie: savedChoice })
        ),
        Effect.provide(
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed(
              session && { ...session, email: testEmailAddress("mirror") }
            ),
          })
        )
      )
    );

  test("mirrors the request's saved choice for the session's account on hydration", async () => {
    await runSignedIn("hydration", { accountId, deletionRequested: false });

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
    await runSignedIn("banner_save", { accountId, deletionRequested: false });

    expect(recorded).toEqual([
      { accountId, decision: "grant", locale: "cs-CZ", source: "banner" },
    ]);
    expect(mirrored).toEqual([]);
  });

  test("records nothing when signed out or while the account is being deleted", async () => {
    for (const occasion of ["hydration", "banner_save"] as const) {
      expect(await runSignedIn(occasion, null)).toBe(false);
      expect(
        await runSignedIn(occasion, { accountId, deletionRequested: true })
      ).toBe(false);
    }
    expect(mirrored).toEqual([]);
    expect(recorded).toEqual([]);
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
              session && { ...session, email: testEmailAddress("silent") }
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

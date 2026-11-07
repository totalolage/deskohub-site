import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
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
} from "./analytics-consent-mirror";

const accountId = customerAccountIdSchema.make("analytics-mirror-account");

let mirrored: AnalyticsConsentMirrorRecord[] = [];
let recorded: AnalyticsConsentDecisionRecord[] = [];

const ledger = Layer.succeed(AnalyticsConsentLedger, {
  record: (input) => Effect.sync(() => void recorded.push(input)),
  mirror: (input) => Effect.sync(() => mirrored.push(input) > 0),
  currentDecision: () => Effect.die("unused"),
});

beforeEach(() => {
  mirrored = [];
  recorded = [];
});

const consentCookie = (value: {
  readonly categories: readonly string[];
  readonly lastConsentTimestamp?: string;
  readonly languageCode?: string;
}) => `theme=dark; cc_cookie=${encodeURIComponent(JSON.stringify(value))}`;

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

  test("mirrors nothing without a saved choice or with a malformed one", async () => {
    for (const cookieHeader of [
      "",
      "theme=dark",
      "cc_cookie=",
      `cc_cookie=${encodeURIComponent("{")}`,
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

  test("records nothing without a saved choice", async () => {
    expect(await run(recordBannerAnalyticsConsent(device("")))).toBe(false);
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
              session && { ...session, email: "mirror@example.test" }
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

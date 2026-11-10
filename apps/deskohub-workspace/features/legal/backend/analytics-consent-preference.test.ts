import { beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  Cause,
  type Context,
  Effect,
  Layer,
  Logger,
  Option,
  References,
} from "effect";
import { AnalyticsPersonAnonymisation } from "@/features/account/backend/analytics-person-anonymisation";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { AnalyticsConsentDecision } from "@/features/legal/analytics-consent-decision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import {
  type AnalyticsConsentDecisionRecord,
  AnalyticsConsentLedger,
  AnalyticsConsentUnavailable,
} from "./analytics-consent-ledger";
import {
  readAnalyticsPreference,
  saveAnalyticsPreference,
} from "./analytics-consent-preference";

const accountId = customerAccountIdSchema.make("analytics-preference-account");
const storedAt = Temporal.Instant.from("2026-11-08T10:00:00.123456Z");

type CurrentDecision = Effect.Success<
  ReturnType<AnalyticsConsentLedger["Service"]["currentDecision"]>
>;

let recorded: AnalyticsConsentDecisionRecord[] = [];
let currentDecision: Effect.Effect<
  CurrentDecision,
  AnalyticsConsentUnavailable
> = Effect.succeed(Option.none());
let anonymised: CustomerAccountId[] = [];
let anonymisation: (accountId: CustomerAccountId) => Effect.Effect<void> = (
  id
) => Effect.sync(() => void anonymised.push(id));

beforeEach(() => {
  recorded = [];
  currentDecision = Effect.succeed(Option.none());
  anonymised = [];
  anonymisation = (id) => Effect.sync(() => void anonymised.push(id));
});

const ledger = Layer.succeed(AnalyticsConsentLedger, {
  record: (input) =>
    Effect.sync(() => {
      recorded.push(input);
      return storedAt;
    }),
  mirror: () => Effect.die("The preference never mirrors a decision"),
  currentDecision: () => currentDecision,
});

const anonymisationLayer = Layer.succeed(AnalyticsPersonAnonymisation, {
  anonymiseDeletedAccount: () =>
    Effect.die("The preference never anonymises a deleted account"),
  anonymiseWithdrawnAccount: (id) => anonymisation(id),
});

type Session = {
  readonly accountId: CustomerAccountId;
  readonly deletionRequested: boolean;
} | null;

const signedIn: Session = { accountId, deletionRequested: false };

const provide = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | AnalyticsConsentLedger
    | AnalyticsPersonAnonymisation
    | CustomerAuthentication
  >,
  session: Session
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        ledger,
        anonymisationLayer,
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed(
            session && {
              ...session,
              ...testSessionProfile,
              email: testEmailAddress("preference"),
            }
          ),
        })
      )
    )
  );

const save = (granted: boolean, session: Session = signedIn) =>
  Effect.runPromise(
    provide(saveAnalyticsPreference({ granted, locale: "en-US" }), session)
  );

const read = (session: Session = signedIn) =>
  Effect.runPromise(provide(readAnalyticsPreference(), session));

const decision = (
  value: AnalyticsConsentDecision,
  documentHash = getLegalDocumentVersion("cs-CZ", "privacy-policy")
): CurrentDecision =>
  Option.some({
    decision: value,
    documentHash,
    locale: "cs-CZ",
    decidedAt: storedAt,
    source: "banner",
  });

describe("saveAnalyticsPreference", () => {
  test("turning the preference off records a withdrawal from preferences and requests the account's anonymisation once", async () => {
    const saved = await save(false);

    expect(Option.getOrUndefined(saved)).toEqual({
      accountId,
      decidedAt: storedAt,
    });
    expect(recorded).toEqual([
      {
        accountId,
        decision: "withdraw",
        locale: "en-US",
        source: "preference",
      },
    ]);
    expect(anonymised).toEqual([accountId]);
  });

  test("turning the preference on records a grant from preferences and requests no anonymisation", async () => {
    const saved = await save(true);

    expect(Option.getOrUndefined(saved)).toEqual({
      accountId,
      decidedAt: storedAt,
    });
    expect(recorded).toEqual([
      { accountId, decision: "grant", locale: "en-US", source: "preference" },
    ]);
    expect(anonymised).toEqual([]);
  });

  test("an anonymisation request that dies never fails the save and logs only a code", async () => {
    const detail = "posthog-response-detail";
    anonymisation = (id) =>
      Effect.sync(() => void anonymised.push(id)).pipe(
        Effect.andThen(Effect.die(new Error(detail)))
      );
    const logs: {
      readonly annotations: Context.Service.Shape<
        typeof References.CurrentLogAnnotations
      >;
      readonly message: unknown;
      readonly defect: boolean;
    }[] = [];
    const logger = Logger.make((options) => {
      logs.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        message: options.message,
        defect: Cause.hasDies(options.cause),
      });
    });

    const saved = await Effect.runPromise(
      provide(
        saveAnalyticsPreference({ granted: false, locale: "en-US" }),
        signedIn
      ).pipe(Effect.provide(Logger.layer([logger])))
    );

    expect(Option.getOrUndefined(saved)).toEqual({
      accountId,
      decidedAt: storedAt,
    });
    expect(recorded.map(({ decision }) => decision)).toEqual(["withdraw"]);
    expect(anonymised).toEqual([accountId]);
    expect(
      logs.map(({ annotations, defect }) => ({ annotations, defect }))
    ).toEqual([
      {
        annotations: { code: "posthog_person_anonymisation_request_failed" },
        defect: false,
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(detail);
    expect(JSON.stringify(logs)).not.toContain(accountId);
  });

  test("records nothing and returns none when signed out or while the account is being deleted", async () => {
    for (const session of [null, { accountId, deletionRequested: true }]) {
      for (const granted of [true, false]) {
        expect(Option.isNone(await save(granted, session))).toBe(true);
      }
    }
    expect(recorded).toEqual([]);
    expect(anonymised).toEqual([]);
  });

  test("a ledger write failure fails the save and requests no anonymisation", async () => {
    const failing = Layer.succeed(AnalyticsConsentLedger, {
      record: () =>
        Effect.fail(new AnalyticsConsentUnavailable({ cause: "down" })),
      mirror: () => Effect.die("unused"),
      currentDecision: () => Effect.die("unused"),
    });

    const result = await Effect.runPromise(
      saveAnalyticsPreference({ granted: false, locale: "en-US" }).pipe(
        Effect.provide(failing),
        Effect.provide(anonymisationLayer),
        Effect.provide(
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.succeed({
              ...signedIn,
              ...testSessionProfile,
              email: testEmailAddress("preference"),
            }),
          })
        ),
        Effect.flip
      )
    );

    expect(result).toBeInstanceOf(AnalyticsConsentUnavailable);
    expect(anonymised).toEqual([]);
  });
});

describe("readAnalyticsPreference", () => {
  test("is granted when the current decision is a grant, under any privacy notice", async () => {
    for (const current of [
      decision("grant"),
      decision("grant", "an-earlier-privacy-notice"),
    ]) {
      currentDecision = Effect.succeed(current);
      expect(await read()).toEqual({ status: "available", granted: true });
    }
  });

  test("is not granted after a withdrawal or without a decision", async () => {
    for (const current of [decision("withdraw"), Option.none()]) {
      currentDecision = Effect.succeed(current);
      expect(await read()).toEqual({ status: "available", granted: false });
    }
  });

  test("is signed out without a session or while the account is being deleted", async () => {
    currentDecision = Effect.succeed(decision("grant"));

    expect(await read(null)).toEqual({ status: "signed-out" });
    expect(await read({ accountId, deletionRequested: true })).toEqual({
      status: "signed-out",
    });
  });

  test("surfaces a ledger read failure as an error, never as not granted", async () => {
    currentDecision = Effect.fail(
      new AnalyticsConsentUnavailable({ cause: "down" })
    );

    const result = await Effect.runPromise(
      provide(readAnalyticsPreference(), signedIn).pipe(Effect.flip)
    );

    expect(result).toBeInstanceOf(AnalyticsConsentUnavailable);
  });
});

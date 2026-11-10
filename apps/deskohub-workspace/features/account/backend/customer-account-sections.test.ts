import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "./customer-account-sections";
import {
  makeCustomerAccountSections,
  sectionAccountEmail,
  sectionAccountId,
} from "./customer-account-sections.test-utils";
import {
  CustomerAuthentication,
  type CustomerAuthenticationEnvironment,
} from "./customer-authentication.service";

const runSections = <A, E>(
  layer: Layer.Layer<CustomerAccountSections>,
  use: (
    sections: CustomerAccountSections["Service"]
  ) => Effect.Effect<A, E, never>
) =>
  CustomerAccountSections.pipe(
    Effect.flatMap(use),
    Effect.provide(layer),
    Effect.result,
    Effect.runPromise
  );

/**
 * The real sections over an injected session authority; reading the account
 * or taking its lock dies, so only the authority's classification decides.
 */
const sectionsReadingEnvironment = (
  environment: CustomerAuthenticationEnvironment
) =>
  CustomerAccountSections.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAuthentication.fromEnvironment(environment),
        Layer.mock(CustomerAccountLinkRepository, {}),
        Layer.mock(WorkspaceDatabaseAdvisoryLock, {})
      )
    )
  );

const recordSection =
  (events: string[]) => (accountId: typeof sectionAccountId | null) =>
    Effect.sync(() => {
      events.push("section");
      return accountId;
    });

describe("CustomerAccountSections.withOptionalAccount", () => {
  test("runs the signed-in account's section holding its lock after the active recheck", async () => {
    const lockProbe = { held: false };
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "active",
      lockProbe,
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount((accountId) =>
        Effect.sync(() => {
          events.push("section");
          return { accountId, held: lockProbe.held };
        })
      )
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: { accountId: sectionAccountId, held: true },
    });
    expect(lockProbe.held).toBe(false);
    // The active recheck reads the account under the lock, not the session
    // again.
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "section",
      "account-lock-released",
    ]);
  });

  test("provides the held account to the section", async () => {
    const { layer } = makeCustomerAccountSections({
      session: {},
      activityState: "active",
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(() =>
        sections.withActiveAccount(
          sectionAccountId,
          Effect.service(HeldCustomerAccount)
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: { accountId: sectionAccountId, email: sectionAccountEmail },
    });
  });

  test("a section for the same account inside it reuses the hold without a second lock or recheck", async () => {
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "active",
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(() =>
        sections.withActiveAccount(
          sectionAccountId,
          Effect.sync(() => {
            events.push("nested-section");
          }),
          { recheck: "session" }
        )
      )
    );

    expect(result._tag).toBe("Success");
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "nested-section",
      "account-lock-released",
    ]);
  });

  test("runs an anonymous section without the lock and with no account", async () => {
    const { layer, events } = makeCustomerAccountSections({ session: null });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({ _tag: "Success", success: null });
    expect(events).toEqual(["section"]);
  });

  test("runs the section without the lock when the authority classifies authentication as not configured", async () => {
    const events: string[] = [];
    const layer = sectionsReadingEnvironment({
      readBetterAuthSecretsRaw: () => undefined,
      readCurrentSession: () =>
        Promise.reject(new Error("session authority rejected")),
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({ _tag: "Success", success: null });
    expect(events).toEqual(["section"]);
  });

  test("fails closed before the section when the configured session authority fails", async () => {
    const events: string[] = [];
    const layer = sectionsReadingEnvironment({
      readBetterAuthSecretsRaw: () =>
        "1:test-only-strong-secret-value-9f2c7a41b8e6d530417c",
      readCurrentSession: () =>
        Promise.reject(new Error("database connection refused")),
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "unavailable",
        cause: { code: "authentication.session" },
      },
    });
    expect(events).toEqual([]);
  });

  test("does not start the section once the account awaits deletion", async () => {
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "deletion-requested",
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "link-required",
        linkReason: "deletion-requested",
      },
    });
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
  });

  test("does not start the section once the account is gone", async () => {
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "missing",
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "unauthenticated",
      },
    });
    expect(events).not.toContain("section");
  });

  test("maps the lock's own failure to account-link.lock without running the section", async () => {
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "active",
      lockUnavailable: true,
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(recordSection(events))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "unavailable",
        cause: { code: "account-link.lock" },
      },
    });
    expect(events).toEqual(["account-session"]);
  });

  test("returns a SqlError the section raises as the same instance", async () => {
    const { layer, events } = makeCustomerAccountSections({
      session: {},
      activityState: "active",
    });
    const sectionFailure = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("reservation write violated a constraint"),
        message: "reservation write violated a constraint",
        operation: "insert",
      }),
    });

    const result = await runSections(layer, (sections) =>
      sections.withOptionalAccount(() => Effect.fail(sectionFailure))
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBe(sectionFailure);
    }
    expect(events).toEqual([
      "account-session",
      "account-lock-acquired",
      "account-activity",
      "account-lock-released",
    ]);
  });
});

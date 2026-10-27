import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Data, Effect, Layer, Predicate, Schema } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CurrentAdministrator } from "../backend/current-administrator";
import { mockAdministratorAccess } from "./administrator-access.test-utils";

const access = mockAdministratorAccess();
const revalidatedPaths: string[] = [];
const refreshedNotes: string[] = [];
let settledRuns = 0;
let revalidationFailure: Error | undefined;
let refreshFailure: Error | undefined;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () =>
    new Headers({ referer: "https://deskohub.test/en-US/admin" }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    // Recorded with the number of runs settled so far, to prove the
    // revalidation came after the action's fiber finished.
    revalidatedPaths.push(`${settledRuns}:${path}`);
    if (revalidationFailure) throw revalidationFailure;
  },
}));

const {
  AdministrationRecordNotFound,
  defineAdministrationAction,
  runAdministrationPage,
} = await import("./administration-request.server");

class Notebook extends Context.Service<
  Notebook,
  { readonly owner: () => string }
>()("@test/Notebook") {}

let notebookBuilds = 0;
const notebookLive = Layer.effect(
  Notebook,
  Effect.gen(function* () {
    notebookBuilds += 1;
    const administrator = yield* CurrentAdministrator;
    return { owner: () => administrator.accountId };
  })
);

class NotebookFull extends Data.TaggedError("NotebookFull") {}

const failureCopy = {
  timeout: m.administrationActionTimedOut,
  unexpected: m.administrationActionFailedUnexpectedly,
};

// The real `redirect` and `notFound` throw errors whose digest names the
// outcome.
const pageOutcome = async <A>(load: () => Promise<A>) => {
  try {
    return { kind: "ok" as const, value: await load() };
  } catch (signal) {
    const digest = Predicate.hasProperty(signal, "digest")
      ? signal.digest
      : undefined;
    if (!Predicate.isString(digest)) throw signal;
    if (digest.startsWith("NEXT_REDIRECT;")) return { kind: "redirect" };
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404") return { kind: "not-found" };
    throw signal;
  }
};

beforeEach(() => {
  access.set("administrator");
  notebookBuilds = 0;
  settledRuns = 0;
  revalidatedPaths.length = 0;
  refreshedNotes.length = 0;
  revalidationFailure = undefined;
  refreshFailure = undefined;
});

describe("runAdministrationPage", () => {
  const ownerQuery = Effect.gen(function* () {
    const notebook = yield* Notebook;
    const administrator = yield* CurrentAdministrator;
    return { owner: notebook.owner(), actor: administrator };
  });

  test("runs the query as the authorized administrator", async () => {
    expect(
      await pageOutcome(() =>
        runAdministrationPage("test.page", ownerQuery, notebookLive)
      )
    ).toEqual({
      kind: "ok",
      value: {
        owner: access.administrator.accountId,
        actor: access.administrator,
      },
    });
  });

  test("answers a missing record with the ordinary 404", async () => {
    expect(
      await pageOutcome(() =>
        runAdministrationPage(
          "test.page",
          Effect.fail(new AdministrationRecordNotFound()),
          Layer.empty
        )
      )
    ).toEqual({ kind: "not-found" });
  });

  test("keeps other query failures as failures", async () => {
    await expect(
      runAdministrationPage(
        "test.page",
        Effect.fail(new NotebookFull()),
        Layer.empty
      )
    ).rejects.toMatchObject({ _tag: "NotebookFull" });
  });

  test.each([
    ["sends a signed-out visitor to sign-in", "signed-out", "redirect"],
    [
      "answers an account without the grant with a 404",
      "not-administrator",
      "not-found",
    ],
  ] as const)("%s before the query starts", async (_, state, kind) => {
    access.set(state);

    expect(
      await pageOutcome(() =>
        runAdministrationPage("test.page", ownerQuery, notebookLive)
      )
    ).toEqual({ kind });
    expect(notebookBuilds).toBe(0);
  });
});

describe("defineAdministrationAction", () => {
  const schema = Schema.toStandardSchemaV1(
    Schema.Struct({ reservationId: Schema.String })
  );
  const reservationPath = (reservationId: string) =>
    administrationHref("/[locale]/admin/reservations/[reservationId]", {
      reservationId,
    });

  const writeNote = (
    outcome: Effect.Effect<
      void,
      NotebookFull | PublicSafeActionError
    > = Effect.void
  ) =>
    defineAdministrationAction(
      {
        operation: "test.write-note",
        schema,
        failureCopy,
        fallback: m.administrationReservationCancellationFailed,
        capabilities: notebookLive,
        revalidates: ({ reservationId }) => [reservationPath(reservationId)],
        refreshes: ({ reservationId }) => {
          refreshedNotes.push(`${settledRuns}:${reservationId}`);
          if (refreshFailure) throw refreshFailure;
        },
      },
      () =>
        Effect.gen(function* () {
          yield* outcome;
          const notebook = yield* Notebook;
          return { owner: notebook.owner() };
        }).pipe(Effect.ensuring(Effect.sync(() => (settledRuns += 1))))
    );

  test("runs as the administrator and revalidates and refreshes after it settles", async () => {
    const result = await writeNote()({ reservationId: "reservation-1" });

    expect(result).toEqual({
      data: { owner: access.administrator.accountId },
    });
    expect(revalidatedPaths).toEqual([`1:${reservationPath("reservation-1")}`]);
    expect(refreshedNotes).toEqual(["1:reservation-1"]);
  });

  test("keeps the result when a refresh fails", async () => {
    refreshFailure = new Error("refresh refused");

    const result = await writeNote()({ reservationId: "reservation-1" });

    expect(result).toEqual({
      data: { owner: access.administrator.accountId },
    });
    expect(revalidatedPaths).toEqual([`1:${reservationPath("reservation-1")}`]);
  });

  test("answers a refused revalidation with the unexpected-failure copy", async () => {
    revalidationFailure = new Error("revalidation refused");

    const result = await writeNote()({ reservationId: "reservation-1" });

    expect(result).toEqual({
      serverError: failureCopy.unexpected({}, { locale: "en-US" }),
    });
    expect(refreshedNotes).toEqual(["1:reservation-1"]);
  });

  test.each(["not-administrator", "signed-out", "unavailable"] as const)(
    "fails closed for a caller who is %s",
    async (state) => {
      access.set(state);

      const result = await writeNote()({ reservationId: "reservation-1" });

      expect(result).toHaveProperty("serverError");
      expect(result).not.toHaveProperty("data");
      expect(notebookBuilds).toBe(0);
      expect(revalidatedPaths).toEqual([]);
      expect(refreshedNotes).toEqual([]);
    }
  );

  test("answers a caller who isn't an administrator with unauthorizedResult", async () => {
    access.set("not-administrator");
    const action = defineAdministrationAction(
      {
        operation: "test.refusal-as-data",
        schema,
        failureCopy,
        capabilities: Layer.empty,
        unauthorizedResult: { _tag: "Refused" } as const,
        revalidates: ({ reservationId }) => [reservationPath(reservationId)],
      },
      () => Effect.succeed({ _tag: "Done" } as const)
    );

    expect(await action({ reservationId: "reservation-1" })).toEqual({
      data: { _tag: "Refused" },
    });
    expect(revalidatedPaths).toEqual([]);
  });

  test("words failures through publicFailure, including the refusal", async () => {
    const action = defineAdministrationAction(
      {
        operation: "test.public-failure",
        schema,
        failureCopy,
        capabilities: Layer.empty,
        publicFailure: (failure) =>
          failure._tag === "NotebookFull" ? "notebook-full" : "refused",
      },
      () => Effect.fail(new NotebookFull())
    );

    expect(await action({ reservationId: "reservation-1" })).toEqual({
      serverError: "notebook-full",
    });
    access.set("not-administrator");
    expect(await action({ reservationId: "reservation-1" })).toEqual({
      serverError: "refused",
    });
  });

  test("keeps a private failure private and skips revalidation", async () => {
    const result = await writeNote(Effect.fail(new NotebookFull()))({
      reservationId: "reservation-1",
    });

    expect(result).toEqual({
      serverError: m.administrationReservationCancellationFailed(
        {},
        { locale: "en-US" }
      ),
    });
    expect(revalidatedPaths).toEqual([]);
    expect(refreshedNotes).toEqual([]);
  });

  test("passes a handler's public error through", async () => {
    const result = await writeNote(
      Effect.fail(new PublicSafeActionError({ message: "handler-public" }))
    )({ reservationId: "reservation-1" });

    expect(result).toEqual({ serverError: "handler-public" });
  });

  test("rejects invalid input before the guard runs", async () => {
    const reads = access.reads();

    const result = await writeNote()(JSON.parse('{ "reservationId": 1 }'));

    expect(result).toHaveProperty("validationErrors");
    expect(access.reads()).toBe(reads);
  });
});

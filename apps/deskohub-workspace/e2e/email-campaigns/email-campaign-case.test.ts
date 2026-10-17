import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMAIL_TEST_DOMAIN } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import {
  type ActionResponseOutcome,
  retainActionSubmission,
  retainServerActionSubmission,
} from "../admin-case";
import { pollUntil } from "../polling";
import { workspaceE2EEmailCampaignMutationBarrierCount } from "../timeouts";
import {
  planEmailCampaignPreview,
  releaseEmailCampaignFixture,
} from "./email-campaign-case";

describe("email campaign preview case planning", () => {
  test("scopes every synthetic identifier to the run", () => {
    const first = planEmailCampaignPreview();
    const second = planEmailCampaignPreview();

    expect(first.customerTag).not.toBe(second.customerTag);
    expect(first.audienceTitle).not.toBe(second.audienceTitle);
    expect(first.campaignTitle).not.toBe(second.campaignTitle);
    expect(first.recipientEmail).not.toBe(second.recipientEmail);
    expect(first.recipientEmail.endsWith(`@${EMAIL_TEST_DOMAIN}`)).toBe(true);
  });
});

describe("email campaign cleanup budget", () => {
  test("budgets every mutation barrier the case waits on", () => {
    const caseSource = readFileSync(
      resolve(import.meta.dir, "email-campaign-case.ts"),
      "utf8"
    );
    // Comment-aware: a commented-out barrier call must not count as a wait.
    const activeCaseSource = caseSource
      .split("\n")
      .map((line) => {
        const commentAt = line.indexOf("//");
        return commentAt === -1 ? line : line.slice(0, commentAt);
      })
      .join("\n");
    const barrierWaits =
      activeCaseSource.split("awaitActionQuiescence(").length - 1;

    expect(barrierWaits).toBe(workspaceE2EEmailCampaignMutationBarrierCount);
  });
});

describe("email campaign fixture release", () => {
  const undispatched = retainActionSubmission(
    Promise.reject(new Error("the submit click timed out"))
  );
  const responded = Promise.resolve<ActionResponseOutcome>({
    kind: "responded",
  });

  const release = (input: {
    readonly audienceSubmission: Promise<ActionResponseOutcome> | undefined;
    readonly campaignSubmission: Promise<ActionResponseOutcome> | undefined;
  }) => {
    const operations: string[] = [];
    const persisted = (label: string) =>
      Effect.gen(function* () {
        operations.push(`converge ${label}`);
        return yield* Effect.fail(new Error(`no ${label} row`));
      });
    const exit = Effect.runPromiseExit(
      withInstantSleeps(
        releaseEmailCampaignFixture({
          ...input,
          audiencePersisted: persisted("audience"),
          barrierTimeoutMs: 20,
          campaignPersisted: persisted("campaign"),
          closeBrowser: Effect.sync(() => {
            operations.push("close");
          }),
          deleteRows: Effect.sync(() => {
            operations.push("delete");
          }),
        })
      )
    );
    return exit.then((settled) => ({ exit: settled, operations }));
  };

  test("deletes the fixture when the audience submit fails before dispatch", async () => {
    const { exit, operations } = await release({
      audienceSubmission: undispatched,
      campaignSubmission: undefined,
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(operations).toEqual(["close", "delete"]);
  });

  test("deletes the fixture when the campaign submit fails before dispatch", async () => {
    const { exit, operations } = await release({
      audienceSubmission: responded,
      campaignSubmission: undispatched,
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(operations).toEqual(["close", "delete"]);
  });

  test("still deletes and then fails when a dispatched action never settles", async () => {
    const { exit, operations } = await release({
      audienceSubmission: new Promise<ActionResponseOutcome>(() => {}),
      campaignSubmission: Promise.resolve({ kind: "unresolved" }),
    });

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([
      "close",
      "converge audience",
      "converge campaign",
      "delete",
    ]);
  });
});

/**
 * Models the Playwright contract the case relies on: a page hands each sent
 * request to pending waits, closing the context rejects those waits and any
 * pending response, and a closed context sends nothing. The server persists
 * the audience row `persistAfterMs` after it receives the request, whether or
 * not the browser is still there for the response. Time is the Effect clock,
 * so run scenarios under `withInstantSleeps`.
 */
const fakeAdminBrowser = (persistAfterMs: number) => {
  type ActionPage = Parameters<typeof retainServerActionSubmission>[0];
  type ActionRequest = Awaited<ReturnType<ActionPage["waitForRequest"]>>;
  const origin = "https://preview.deskohub.test";
  const onClose = new Set<() => void>();
  const waits = new Set<(request: ActionRequest) => void>();
  const state = { closed: false, refusedDispatches: 0, rows: 0 };
  const untilClosed = <A>(register: (resolve: (value: A) => void) => void) =>
    new Promise<A>((resolve, reject) => {
      const closed = () => reject(new Error("Target page has been closed"));
      if (state.closed) {
        closed();
        return;
      }
      onClose.add(closed);
      register(resolve);
    });
  const page: ActionPage = {
    waitForRequest: (predicate) =>
      untilClosed((resolve) => {
        const deliver = (request: ActionRequest) => {
          if (!predicate(request)) return;
          waits.delete(deliver);
          resolve(request);
        };
        waits.add(deliver);
      }),
  };
  const send = Effect.sync(() => {
    if (state.closed) {
      state.refusedDispatches += 1;
      return false;
    }
    const request: ActionRequest = {
      headers: () => ({ "next-action": "save-audience" }),
      method: () => "POST",
      // The server is still running the action when the context closes.
      response: () => untilClosed<null>(() => undefined),
      url: () => `${origin}/en-US/admin/email-audiences/new`,
    };
    for (const deliver of [...waits]) deliver(request);
    return true;
  });
  return {
    closeBrowser: Effect.sync(() => {
      state.closed = true;
      for (const close of onClose) close();
    }),
    deleteRows: Effect.sync(() => {
      state.rows = 0;
    }),
    /** Sends the save request, then persists its row on the server side. */
    dispatch: Effect.gen(function* () {
      if (!(yield* send)) return;
      yield* Effect.sleep(`${persistAfterMs} millis`);
      state.rows += 1;
    }),
    persisted: pollUntil(
      Effect.sync(() => (state.rows > 0 ? true : undefined)),
      { intervalMs: 5, label: "the fake audience row", timeoutMs: 200 }
    ),
    retainSubmission: () => retainServerActionSubmission(page, origin),
    state,
  };
};

describe("email campaign fixture release after a late dispatch", () => {
  const releaseAudience = (
    browser: ReturnType<typeof fakeAdminBrowser>,
    audienceSubmission: Promise<ActionResponseOutcome>
  ) =>
    Effect.exit(
      releaseEmailCampaignFixture({
        audiencePersisted: browser.persisted,
        audienceSubmission,
        barrierTimeoutMs: 20,
        campaignPersisted: browser.persisted,
        campaignSubmission: undefined,
        closeBrowser: browser.closeBrowser,
        deleteRows: browser.deleteRows,
      })
    );

  test("refuses a submit the browser attempts after the step timed out", async () => {
    const browser = fakeAdminBrowser(10);
    // The click succeeded, but the save request had not left the browser when
    // the step's 20 ms wait ran out; the browser tries to send it at 40 ms.
    const submission = browser.retainSubmission();
    const exit = await Effect.runPromise(
      withInstantSleeps(
        Effect.gen(function* () {
          yield* Effect.forkChild(Effect.delay(browser.dispatch, "40 millis"));
          yield* Effect.sleep("20 millis");
          const released = yield* releaseAudience(browser, submission);
          yield* Effect.sleep("60 millis");
          return released;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await submission).toEqual({ kind: "undispatched" });
    expect(browser.state.refusedDispatches).toBe(1);
    expect(browser.state.rows).toBe(0);
  });

  test("waits for a submit sent just before the close to persist before deleting", async () => {
    const browser = fakeAdminBrowser(30);
    const submission = browser.retainSubmission();
    const exit = await Effect.runPromise(
      withInstantSleeps(
        Effect.gen(function* () {
          // The request leaves the browser before the release closes it.
          yield* Effect.forkChild(browser.dispatch, { startImmediately: true });
          const released = yield* releaseAudience(browser, submission);
          yield* Effect.sleep("60 millis");
          return released;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await submission).toEqual({ kind: "unresolved" });
    expect(browser.state.refusedDispatches).toBe(0);
    expect(browser.state.rows).toBe(0);
  });
});

import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { PostHogProjectId } from "@deskohub/posthog/identifiers";
import type { AnyValue } from "@opentelemetry/api-logs";
import { Duration, Effect, Layer, Option, Redacted } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import type { AnalyticsConsentDecision } from "@/features/legal/analytics-consent-decision";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";
import { customerAccountIdSchema } from "../customer-account";

const request = await mockWorkspaceActionRequest();
const workspaceLogs = captureWorkspaceLogs();

const { AnalyticsPersonAnonymisation } = await import(
  "./analytics-person-anonymisation"
);
const { AnalyticsConsentLedger, AnalyticsConsentUnavailable } = await import(
  "@/features/legal/backend/analytics-consent-ledger"
);
const { PostHogPersonPrivacyConfig } = await import(
  "@/shared/backend/config/posthog-person-privacy.config"
);

const accountId = customerAccountIdSchema.make("synthetic-account-1044");
const personKey = "synthetic-person-privacy-key";

beforeEach(() => {
  request.reset();
  workspaceLogs.reset();
});

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

type PostHogAnswer =
  | {
      readonly status: number;
      readonly body?: unknown;
      /** Runs when PostHog gives this answer. */
      readonly onAnswer?: () => void;
    }
  | "transport-failure";

/** A PostHog API that records each request and gives the next answer; the last answer repeats. */
const makePostHog = (answers: readonly PostHogAnswer[]) => {
  const requests: RecordedRequest[] = [];
  const client = HttpClient.make((outgoing, url) =>
    Effect.suspend(() => {
      requests.push({
        method: outgoing.method,
        url: url.toString(),
        authorization: outgoing.headers.authorization,
        body:
          outgoing.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(outgoing.body.body))
            : undefined,
      });
      const answer = answers[requests.length - 1] ?? answers.at(-1);
      if (answer === undefined || answer === "transport-failure") {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request: outgoing,
              description: "synthetic transport failure",
            }),
          })
        );
      }
      answer.onAnswer?.();
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          outgoing,
          Response.json(answer.body ?? {}, { status: answer.status })
        )
      );
    })
  );
  return { client, requests };
};

const deleted = {
  status: 202,
  body: {
    persons_found: 1,
    persons_deleted: 1,
    persons_queued_for_deletion: 0,
    events_queued_for_deletion: false,
    recordings_queued_for_deletion: false,
  },
};

const configured = Option.some({
  apiKey: Redacted.make(personKey),
  host: new URL("https://eu.posthog.test"),
  projectId: PostHogProjectId.make("1044"),
  attemptTimeout: Duration.seconds(5),
});

const decisionOf = (decision: AnalyticsConsentDecision) =>
  Option.some({
    decision,
    documentHash: "synthetic-privacy-notice-hash",
    locale: "en-US" as const,
    decidedAt: Temporal.Instant.from("2026-11-08T10:00:00Z"),
    source: "preference" as const,
  });

/** What the fake ledger answers: a current decision, none, or a failed read. */
const ledgerState = (
  state: AnalyticsConsentDecision | "none" | "unavailable"
) => state;

/**
 * The service over a recording PostHog API and a ledger whose current
 * decision `ledger.current` names when the deletion is dispatched.
 */
const makeAnonymisation = ({
  answers = [deleted],
  persons = configured,
}: {
  readonly answers?: readonly PostHogAnswer[];
  readonly persons?: typeof configured;
} = {}) => {
  const postHog = makePostHog(answers);
  const ledger = { current: ledgerState("withdraw"), reads: 0 };
  const layer = AnalyticsPersonAnonymisation.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(PostHogPersonPrivacyConfig, { persons }),
        Layer.mock(AnalyticsConsentLedger, {
          currentDecision: () =>
            Effect.suspend(() => {
              ledger.reads += 1;
              if (ledger.current === "unavailable") {
                return Effect.fail(
                  new AnalyticsConsentUnavailable({ cause: "synthetic" })
                );
              }
              return Effect.succeed(
                ledger.current === "none"
                  ? Option.none()
                  : decisionOf(ledger.current)
              );
            }),
        }),
        Layer.succeed(HttpClient.HttpClient, postHog.client)
      )
    )
  );
  const schedule = (
    anonymise: (
      service: Parameters<typeof AnalyticsPersonAnonymisation.of>[0]
    ) => Effect.Effect<void>
  ) =>
    Effect.runPromise(
      Effect.flatMap(AnalyticsPersonAnonymisation, anonymise).pipe(
        Effect.provide(layer)
      )
    );
  return { ledger, postHog, schedule };
};

/** Runs the work scheduled after the response, as Next does once it is sent. */
const sendResponse = async () => {
  const scheduled = request.after.mock.calls as [() => unknown][];
  for (const [callback] of scheduled) await callback();
};

// The logger serializes structured log values to JSON strings.
const parseLogged = (value: AnyValue | undefined) => JSON.parse(String(value));

const loggedCodes = () =>
  workspaceLogs
    .records()
    .map(({ body }) =>
      Array.isArray(body) && body[1] !== undefined
        ? parseLogged(body[1]).code
        : undefined
    )
    .filter((code) => code !== undefined);

const expectLogsFreeOfIdentifiers = () => {
  const logged = JSON.stringify(
    workspaceLogs
      .records()
      .map(({ attributes, body }) => ({ attributes, body }))
  );
  expect(logged).not.toContain(accountId);
  expect(logged).not.toContain("workspace-account:");
  expect(logged).not.toContain(personKey);
};

describe("AnalyticsPersonAnonymisation", () => {
  test("deletes a deleted account's PostHog person after the response and keeps its events", async () => {
    const { postHog, schedule, ledger } = makeAnonymisation();
    ledger.current = "grant";

    await schedule((service) => service.anonymiseDeletedAccount(accountId));
    expect(postHog.requests).toEqual([]);

    await sendResponse();

    expect(postHog.requests).toEqual([
      {
        method: "POST",
        url: "https://eu.posthog.test/api/projects/1044/persons/bulk_delete/",
        authorization: `Bearer ${personKey}`,
        body: {
          distinct_ids: [`workspace-account:${accountId}`],
          delete_events: false,
          delete_recordings: false,
        },
      },
    ]);
    // A deleted account's person goes whatever the ledger last said.
    expect(ledger.reads).toBe(0);
    expect(loggedCodes()).toContain("posthog_person_anonymised");
    expectLogsFreeOfIdentifiers();
  });

  test("deletes a withdrawn account's person while the account still withdraws", async () => {
    const { postHog, schedule, ledger } = makeAnonymisation();

    await schedule((service) => service.anonymiseWithdrawnAccount(accountId));
    await sendResponse();

    expect(postHog.requests).toHaveLength(1);
    expect(ledger.reads).toBe(1);
    expect(loggedCodes()).toContain("posthog_person_anonymised");
    expectLogsFreeOfIdentifiers();
  });

  test("skips a withdrawn account's deletion once a grant follows the withdrawal", async () => {
    const { postHog, schedule, ledger } = makeAnonymisation();

    await schedule((service) => service.anonymiseWithdrawnAccount(accountId));
    ledger.current = "grant";
    await sendResponse();

    expect(postHog.requests).toEqual([]);
    expect(loggedCodes()).toContain("posthog_person_anonymisation_skipped");
    expectLogsFreeOfIdentifiers();
  });

  test("skips a withdrawn account's deletion when the ledger holds no decision or can't be read", async () => {
    for (const current of ["none", "unavailable"] as const) {
      request.reset();
      const { postHog, schedule: anonymise, ledger } = makeAnonymisation();
      ledger.current = current;

      await anonymise((service) =>
        service.anonymiseWithdrawnAccount(accountId)
      );
      await sendResponse();

      expect(postHog.requests).toEqual([]);
    }
    expect(loggedCodes()).toEqual(
      expect.arrayContaining([
        "posthog_person_anonymisation_skipped",
        "posthog_person_anonymisation_ledger_unavailable",
      ])
    );
    expectLogsFreeOfIdentifiers();
  });

  test("sends nothing and warns when the person privacy key is missing", async () => {
    const { postHog, schedule } = makeAnonymisation({ persons: Option.none() });

    await schedule((service) => service.anonymiseDeletedAccount(accountId));
    await schedule((service) => service.anonymiseWithdrawnAccount(accountId));
    await sendResponse();

    expect(postHog.requests).toEqual([]);
    expect(loggedCodes()).toEqual([
      "posthog_person_anonymisation_unavailable",
      "posthog_person_anonymisation_unavailable",
    ]);
    expectLogsFreeOfIdentifiers();
  });

  test("logs, never raises, a PostHog server error or lost connection, and sends it once", async () => {
    for (const answer of [{ status: 503 }, "transport-failure"] as const) {
      request.reset();
      const { postHog, schedule: anonymise } = makeAnonymisation({
        answers: [answer],
      });

      await anonymise((service) => service.anonymiseDeletedAccount(accountId));
      await sendResponse();

      expect(postHog.requests).toHaveLength(1);
    }
    expect(loggedCodes()).toEqual(
      expect.arrayContaining(["posthog_person_anonymisation_uncertain"])
    );
    expectLogsFreeOfIdentifiers();
  });

  test("checks the ledger again before a retry and stops once a grant follows", async () => {
    const grantAfterFirstAttempt = { now: () => {} };
    const { postHog, schedule, ledger } = makeAnonymisation({
      answers: [
        { status: 429, onAnswer: () => grantAfterFirstAttempt.now() },
        deleted,
      ],
    });
    grantAfterFirstAttempt.now = () => {
      ledger.current = "grant";
    };

    await schedule((service) => service.anonymiseWithdrawnAccount(accountId));
    await sendResponse();

    expect(postHog.requests).toHaveLength(1);
    expect(ledger.reads).toBe(2);
    expect(loggedCodes()).toContain("posthog_person_anonymisation_skipped");
    expectLogsFreeOfIdentifiers();
  });

  test("logs, never raises, a rate limit that outlasts its retries", async () => {
    const { postHog, schedule } = makeAnonymisation({
      answers: [{ status: 429 }],
    });

    await schedule((service) => service.anonymiseDeletedAccount(accountId));
    await sendResponse();

    expect(postHog.requests.length).toBeGreaterThan(1);
    expect(loggedCodes()).toContain("posthog_person_anonymisation_failed");
    expectLogsFreeOfIdentifiers();
  });
});

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isTestEmailAddress } from "@deskohub/test-email";
import { Context, Effect, Option } from "effect";
import { workspaceE2EAccountCaseIds } from "./account/catalog";
import { workspaceE2EAccountLaneId } from "./account/journal";
import { getWorkspaceE2EDateInterval } from "./capacity";
import { tryWorkspaceE2EPromise, workspaceE2EError } from "./errors";
import { isWorkspaceE2ECaseId } from "./playwright-checkout/case-catalog";
import {
  type ReservationIntent,
  readReservationJournal,
  writeReservationJournal,
} from "./reservation-journal";
import { workspaceDir } from "./runtime";
import { E2ERunContextService } from "./services/telemetry";
import type { CheckoutData } from "./types";

export const CurrentReservationCase = Context.Reference(
  "CurrentReservationCase",
  {
    defaultValue: ():
      | { readonly caseId: string; readonly journalPath: string | undefined }
      | undefined => undefined,
  }
);

/** A missing real-run case journal refuses admission before the create. */
export const recordReservationIntent = Effect.fn("E2E.recordReservationIntent")(
  function* (input: {
    readonly owner: ReservationIntent["owner"];
    readonly startDate: Date;
    readonly endDate: Date;
  }) {
    const context = yield* Effect.serviceOption(E2ERunContextService);
    // Unit tests without a real run context create no campaign evidence.
    if (Option.isNone(context)) return undefined;
    const current = yield* CurrentReservationCase;
    const caseId = current?.caseId;
    const runId = context.value.value.runId;
    const journal = current?.journalPath;
    if (
      !caseId ||
      !reservationIntentJournalPath(caseId) ||
      !journal ||
      ("email" in input.owner && !isTestEmailAddress(input.owner.email)) ||
      !Number.isFinite(input.startDate.getTime()) ||
      !Number.isFinite(input.endDate.getTime()) ||
      input.endDate.getTime() <= input.startDate.getTime()
    ) {
      return yield* workspaceE2EError("Reservation intent coverage is unknown");
    }
    const intent: ReservationIntent = {
      id: randomUUID(),
      runId,
      caseId,
      owner: input.owner,
      startDate: input.startDate.toISOString(),
      endDate: input.endDate.toISOString(),
    };
    yield* tryWorkspaceE2EPromise("persist reservation intent", async () => {
      if (!(await readReservationJournal(journal))) {
        throw new Error("Missing reservation owner journal");
      }
      await writeReservationJournal(journal, {}, intent);
    });
    return { intent, journal };
  }
);

export const recordCheckoutIntent = (data: CheckoutData) => {
  let selected: CheckoutData["meetingRoom"] | CheckoutData["office"];
  const kind = data.expectedReservationDetails.kind;
  if (kind === "meeting-room") selected = data.meetingRoom;
  if (kind === "office") selected = data.office;
  if (kind !== "cowork" && !selected) {
    return Effect.fail(
      workspaceE2EError("Reservation interval coverage is unknown")
    );
  }
  const interval = selected
    ? {
        startDate: new Date(selected.startsAt),
        endDate: new Date(selected.endsAt),
      }
    : getWorkspaceE2EDateInterval({ fromDate: data.date, toDate: data.date });
  return recordReservationIntent({ owner: { email: data.email }, ...interval });
};

export const recordReservationResult = (
  recorded: Effect.Success<ReturnType<typeof recordReservationIntent>>,
  result: Pick<ReservationIntent, "orderId" | "reservationId">
) =>
  recorded
    ? tryWorkspaceE2EPromise("persist reservation result", () =>
        writeReservationJournal(
          recorded.journal,
          {},
          { ...recorded.intent, ...result }
        )
      )
    : Effect.void;

export const reservationIntentJournalPath = (caseId: string) => {
  if (isWorkspaceE2ECaseId(caseId)) {
    return resolve(
      workspaceDir,
      "e2e-artifacts/checkout/cleanup-journals",
      `${caseId}.json`
    );
  }
  if ((workspaceE2EAccountCaseIds as readonly string[]).includes(caseId)) {
    return resolve(
      workspaceDir,
      "e2e-artifacts/checkout/account-journals",
      `${workspaceE2EAccountLaneId}.json`
    );
  }
  return undefined;
};

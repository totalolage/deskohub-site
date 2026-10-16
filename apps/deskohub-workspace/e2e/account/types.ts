import type { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { E2ETelemetryService } from "../services/telemetry";
import type { WorkspaceE2EStepRunner } from "../types";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { WorkspaceE2EAccountJournal } from "./journal";

export type WorkspaceE2EAccountRequirement =
  | E2EDatabase
  | E2ETelemetryService
  | HttpClient.HttpClient;

type WorkspaceE2ESignInConfirmation = "inbox" | "code";

/**
 * In-memory handoff for the worker-scoped account lifecycle. The lane fixture
 * owns the one instance because Playwright rebuilds the case factory for every
 * test; it never carries persisted state and stays out of the cleanup journal.
 */
export type WorkspaceE2EPasskeySignInOffer = "offered" | "absent";

export type WorkspaceE2EAccountLifecycleHandoff = {
  firstAcceptedRequestedAt?: Date;
  /**
   * The step the sign-in form showed once it accepted an email: the inbox
   * notice, or the code step the `login_email_code` flag adds. The preview's
   * flag decides it, so the lane reads it from the UI.
   */
  signInConfirmation?: WorkspaceE2ESignInConfirmation;
  /**
   * Whether the sign-in form offered passkey sign-in. The preview's
   * `login_passkeys` flag decides it, so the lane reads it from the UI.
   */
  passkeySignIn?: WorkspaceE2EPasskeySignInOffer;
  /**
   * The second unknown email's request, whose emailed code the sign-in code
   * case enters while the form still shows that request's code step.
   */
  secondAcceptedRequestedAt?: Date;
  /**
   * The synthetic referrer's share code, which the main account follows from
   * its first anonymous visit through sign-in into profile completion.
   */
  referralInvitation?: {
    readonly code: string;
    readonly referrerCustomerId: string;
  };
  reauthentication?: {
    link: string;
    userId: string;
    linkedCustomerId: string;
  };
  deletedUserId?: string;
  retainedCustomerId?: string;
};

export type WorkspaceE2EAccountJournalRef = {
  readonly journal: WorkspaceE2EAccountJournal;
  readonly record: (
    update: Pick<
      WorkspaceE2EAccountJournal,
      "authUserIds" | "dotyposCustomerIds" | "dotyposReservationIds"
    >
  ) => Promise<void>;
};

export type WorkspaceE2EAccountCaseCompletion = {
  readonly cleanup: Effect.Effect<
    void,
    WorkspaceE2EError,
    WorkspaceE2EAccountRequirement
  >;
};

export type WorkspaceE2EAccountCase = {
  readonly execute: (context: {
    readonly journalRef: WorkspaceE2EAccountJournalRef;
    readonly runStep: WorkspaceE2EStepRunner;
    readonly session: string;
  }) => Effect.Effect<
    WorkspaceE2EAccountCaseCompletion,
    WorkspaceE2EError,
    WorkspaceE2EAccountRequirement
  >;
  readonly id: WorkspaceE2EAccountCaseId;
  readonly timeoutMs: number;
};

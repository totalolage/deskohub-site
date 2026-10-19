import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import type { Runner } from "../runtime";
import { makeWorkspaceE2EAccountRecipientForRunId } from "./config";
import { createSyntheticCustomerProfile } from "./fixtures";
import {
  makeWorkspaceE2EAccountJournalRecorder,
  type WorkspaceE2EAccountJournalOwnerId,
} from "./journal";
import { workspaceE2EAccountProfileFixture } from "./profile-fixture";
import {
  seedWorkspaceE2ESyntheticAccount,
  signInWorkspaceE2ESyntheticAccount,
  type WorkspaceE2ESessionSigningSecret,
} from "./seeded-session";

export type WorkspaceE2ECaseAccount = {
  readonly accountId: string;
  readonly email: string;
  readonly name: string;
  readonly phone: string;
};

export type WorkspaceE2ECaseLinkedAccount = WorkspaceE2ECaseAccount & {
  readonly customerId: DotyposCustomerId;
};

/**
 * The seeded synthetic accounts of one case. Every row is journaled under the
 * case's own journal owner before or as it is created, and every recipient
 * derives from the run id and one of the owner's closed labels, so suite
 * cleanup can validate and reconcile it even after an interruption.
 */
export const makeWorkspaceE2ECaseIdentities = <Label extends string>({
  baseUrl,
  datasourceConfig,
  displayName,
  journalOwnerId,
  run,
  runId,
  secret,
}: {
  readonly baseUrl: string;
  readonly datasourceConfig: DatasourceConfig;
  /** The account and profile name for one label. */
  readonly displayName: (label: Label) => string;
  readonly journalOwnerId: WorkspaceE2EAccountJournalOwnerId;
  readonly run: Runner;
  readonly runId: WorkspaceE2ERunId;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}) => {
  const recorder = makeWorkspaceE2EAccountJournalRecorder(journalOwnerId);
  const record = (
    update: Parameters<typeof recorder.record>[0]
  ): Effect.Effect<void, WorkspaceE2EError> =>
    Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("record case identity", {
          cause,
          operation: "record case identity",
        }),
      try: () => recorder.record(update),
    });

  const describe = (label: Label) =>
    ({
      accountId: customerAccountIdSchema.make(
        `${journalOwnerId}-${label}-${crypto.randomUUID()}`
      ),
      email: makeWorkspaceE2EAccountRecipientForRunId(runId, label),
      name: displayName(label),
      phone: workspaceE2EAccountProfileFixture.phone,
    }) satisfies WorkspaceE2ECaseAccount;

  /** A synthetic Dotypos profile for one label, journaled once it exists. */
  const createCustomer = (
    label: Label
  ): Effect.Effect<DotyposCustomerId, WorkspaceE2EError> =>
    Effect.gen(function* () {
      const account = describe(label);
      const customerId = yield* createSyntheticCustomerProfile(
        datasourceConfig,
        {
          email: account.email,
          firstName: account.name,
          phone: account.phone,
        }
      );
      yield* record({ dotyposCustomerIds: [customerId] });
      return customerId;
    });

  return {
    createCustomer,
    describe,
    record,

    /** Records a booked customer the case did not create itself. */
    journalCustomer: (customerId: DotyposCustomerId) =>
      record({ dotyposCustomerIds: [customerId] }),

    /**
     * A verified Better Auth user without a customer link: the state right
     * after a first magic-link sign-in.
     */
    seedUnlinkedAccount: (
      label: Label
    ): Effect.Effect<WorkspaceE2ECaseAccount, WorkspaceE2EError, E2EDatabase> =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        yield* seedWorkspaceE2ESyntheticAccount(account);
        return account;
      }),

    /** A completed profile: a verified user linked to its own new customer. */
    seedLinkedAccount: (
      label: Label
    ): Effect.Effect<
      WorkspaceE2ECaseLinkedAccount,
      WorkspaceE2EError,
      E2EDatabase
    > =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        const customerId = yield* createCustomer(label);
        yield* seedWorkspaceE2ESyntheticAccount({
          ...account,
          linkedCustomerId: customerId,
        });
        return { ...account, customerId };
      }),

    /** Signs this case's browser session in as one of its accounts. */
    signIn: (
      account: Pick<WorkspaceE2ECaseAccount, "accountId">,
      session: string
    ) =>
      signInWorkspaceE2ESyntheticAccount({
        accountId: account.accountId,
        baseUrl,
        run,
        secret,
        session,
      }),
  };
};

export type WorkspaceE2ECaseIdentities<Label extends string> = ReturnType<
  typeof makeWorkspaceE2ECaseIdentities<Label>
>;

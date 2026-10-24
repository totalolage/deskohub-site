import type { BrowserContext } from "@playwright/test";
import { Effect } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { AccountRole } from "@/features/administrators/account-role";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { makeWorkspaceE2EAccountJournalRecorder } from "../account/journal";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import {
  revokeWorkspaceE2ESyntheticAccountRoles,
  seedWorkspaceE2ESyntheticAccount,
  signInWorkspaceE2ESyntheticBrowserContext,
  type WorkspaceE2ESessionSigningSecret,
} from "../account/seeded-session";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ERunId } from "../run-identifiers";

/**
 * The exact run-scoped recipient labels each administration case may own. A
 * case journals only identities derived from its own labels, so suite cleanup
 * validates every journaled row against this closed set.
 */
const workspaceE2EAdministrationRecipientLabels = {
  "access-code-creation": ["acc-admin"],
  "administrator-agent-tools": ["aat-admin"],
  "administrator-agent-tools-customer-refusal": ["aatc-member"],
  "administrator-non-administrator-refusal": ["anr-member"],
  "administrator-sign-in-return": ["asr-admin"],
  "automation-reservation-booked": ["arb-admin"],
  "email-campaign-recipient-preview": ["ecp-admin"],
} as const satisfies Record<string, readonly string[]>;

export type WorkspaceE2EAdministrationCaseId =
  keyof typeof workspaceE2EAdministrationRecipientLabels;

/** The checkout suite's administration journal owners, reconciled by its cleanup. */
export const workspaceE2EAdministrationJournalOwners: readonly WorkspaceE2EAccountJournalOwner[] =
  Object.entries(workspaceE2EAdministrationRecipientLabels).map(
    ([ownerId, recipientLabels]) => ({ ownerId, recipientLabels })
  );

export type WorkspaceE2EAdministrationAccount = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  readonly name: string;
};

/**
 * The synthetic accounts of one administration case or suite. Each account is
 * journaled under its owner before its row exists and derives its recipient
 * from the run id and one of the owner's closed labels, so cleanup can
 * validate and delete it even after an interruption. Deleting the user
 * cascades its sessions and role grants.
 */
export const makeWorkspaceE2EAdministrationIdentities = <Label extends string>({
  journalDirectory,
  ownerId,
  runId,
  secret,
}: {
  readonly journalDirectory?: string;
  readonly ownerId: string;
  readonly runId: WorkspaceE2ERunId;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}) => {
  const recorder = makeWorkspaceE2EAccountJournalRecorder(
    ownerId,
    journalDirectory
  );
  return {
    /**
     * Seeds one verified synthetic account with the given role grants. An
     * empty role list seeds an ordinary signed-up customer account.
     */
    seed: (
      label: Label,
      roles: readonly AccountRole[]
    ): Effect.Effect<
      WorkspaceE2EAdministrationAccount,
      WorkspaceE2EError,
      E2EDatabase
    > =>
      Effect.gen(function* () {
        const account = {
          accountId: customerAccountIdSchema.make(
            `${ownerId}-${label}-${crypto.randomUUID()}`
          ),
          email: makeWorkspaceE2EAccountRecipientForRunId(runId, label),
          name: `Workspace E2E ${label}`,
        } satisfies WorkspaceE2EAdministrationAccount;
        yield* Effect.tryPromise({
          catch: (cause) =>
            workspaceE2EError("record administration case identity", {
              cause,
              operation: "record administration case identity",
            }),
          try: () => recorder.record({ authUserIds: [account.accountId] }),
        });
        yield* seedWorkspaceE2ESyntheticAccount({ ...account, roles });
        return account;
      }),

    /**
     * Removes the role grants of one of the seeded accounts; its sessions
     * and agent tokens stay.
     */
    revokeRoles: (
      account: Pick<WorkspaceE2EAdministrationAccount, "accountId">
    ) => revokeWorkspaceE2ESyntheticAccountRoles(account.accountId),

    /** Signs a browser context in as one of the seeded accounts. */
    signIn: (
      account: Pick<WorkspaceE2EAdministrationAccount, "accountId">,
      browser: {
        readonly context: Pick<BrowserContext, "addCookies">;
        readonly origin: string;
      }
    ) =>
      signInWorkspaceE2ESyntheticBrowserContext({
        accountId: account.accountId,
        context: browser.context,
        origin: browser.origin,
        secret,
      }),
  };
};

export type WorkspaceE2EAdministrationIdentities<Label extends string> =
  ReturnType<typeof makeWorkspaceE2EAdministrationIdentities<Label>>;

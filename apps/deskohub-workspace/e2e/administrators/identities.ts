import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { AccountRole } from "@/features/administrators/account-role";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import { createSyntheticCustomerProfile } from "../account/fixtures";
import { makeWorkspaceE2EAccountJournalRecorder } from "../account/journal";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import {
  revokeWorkspaceE2ESyntheticAccountRoles,
  seedWorkspaceE2ESyntheticAccount,
  signInWorkspaceE2ESyntheticBrowserSession,
  type WorkspaceE2ESessionSigningSecret,
} from "../account/seeded-session";
import type { E2EBrowserSession } from "../browser-session";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { addRedaction } from "../redaction";
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
  "administrator-invoice-customer-download": ["aicd-admin", "aicd-customer"],
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

export type WorkspaceE2EAdministrationLinkedAccount =
  WorkspaceE2EAdministrationAccount & {
    readonly customerId: DotyposCustomerId;
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
  const record = (
    update: Parameters<typeof recorder.record>[0]
  ): Effect.Effect<void, WorkspaceE2EError> =>
    Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("record administration case identity", {
          cause,
          operation: "record administration case identity",
        }),
      try: () => recorder.record(update),
    });
  const describe = (label: Label) =>
    ({
      accountId: customerAccountIdSchema.make(
        `${ownerId}-${label}-${crypto.randomUUID()}`
      ),
      email: makeWorkspaceE2EAccountRecipientForRunId(runId, label),
      name: `Workspace E2E ${label}`,
    }) satisfies WorkspaceE2EAdministrationAccount;

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
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        yield* seedWorkspaceE2ESyntheticAccount({ ...account, roles });
        return account;
      }),

    /**
     * Seeds an ordinary customer account whose profile is complete: it is
     * linked to a new synthetic Dotypos profile with the account's own
     * recipient. Both are journaled, so suite cleanup expires the profile.
     */
    seedLinkedCustomer: (
      label: Label,
      datasourceConfig: DatasourceConfig
    ): Effect.Effect<
      WorkspaceE2EAdministrationLinkedAccount,
      WorkspaceE2EError,
      E2EDatabase
    > =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        const customerId = yield* createSyntheticCustomerProfile(
          datasourceConfig,
          { email: account.email, firstName: account.name }
        );
        addRedaction(customerId);
        yield* record({ dotyposCustomerIds: [customerId] });
        yield* seedWorkspaceE2ESyntheticAccount({
          ...account,
          linkedCustomerId: customerId,
        });
        return { ...account, customerId };
      }),

    /**
     * Journals an invoice the case issued. Issued invoices are retained, so
     * cleanup keeps it beside the expired profile it names.
     */
    recordRetainedInvoice: (invoiceId: string) =>
      record({ retainedInvoiceIds: [invoiceId] }),

    /**
     * Removes the role grants of one of the seeded accounts; its sessions
     * and agent tokens stay.
     */
    revokeRoles: (
      account: Pick<WorkspaceE2EAdministrationAccount, "accountId">
    ) => revokeWorkspaceE2ESyntheticAccountRoles(account.accountId),

    /** Signs a browser session in as one of the seeded accounts. */
    signIn: (
      account: Pick<WorkspaceE2EAdministrationAccount, "accountId">,
      browser: {
        readonly origin: string;
        readonly session: E2EBrowserSession;
      }
    ) =>
      signInWorkspaceE2ESyntheticBrowserSession({
        accountId: account.accountId,
        origin: browser.origin,
        secret,
        session: browser.session,
      }),
  };
};

export type WorkspaceE2EAdministrationIdentities<Label extends string> =
  ReturnType<typeof makeWorkspaceE2EAdministrationIdentities<Label>>;

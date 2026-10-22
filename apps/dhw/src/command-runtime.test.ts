import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  administrationOperations,
  CliAccessToken,
  CliSessionId,
  toAdministrationActorName,
  WorkspaceAdminApi,
  type WorkspaceAdminOperationReference,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { AccessCodeAttemptStore } from "./access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

type Api = WorkspaceAdminApiClient["Service"];

/**
 * A command that confirms a destructive operation: arguments that reach its
 * confirmation, and the reads it makes before asking.
 */
type ConfirmedCommand = {
  readonly args: ReadonlyArray<string>;
  readonly inputFile?: { readonly contents: string; readonly path: string };
  readonly operation: WorkspaceAdminOperationReference;
  readonly reads?: Partial<Api>;
};

const approverEmail = AdministrationActorEmail.make(
  testEmailAddress("confirmation-test-approver")
);
const sessionId = Schema.decodeUnknownSync(CliSessionId)(
  "01980000-0000-7000-8000-000000000000"
);
const codeId = "01980000-0000-7000-8000-000000000001";
const reservationId = "reservation-confirmation-test";
const campaignId = "campaign-confirmation-test";
const campaignAudienceId = "audience-confirmation-test";
const customerId = "customer-confirmation-test";
const administratorAccountId = "account-confirmation-test";
const discountGroupId = "discount-group-confirmation-test";
const discountId = "01980000-0000-7000-8000-000000000004";
const voucherId = "voucher-confirmation-test";
const invoiceInputPath = `/tmp/dhw-confirmation-invoice-${crypto.randomUUID()}.json`;
const invoiceInputFile = {
  path: invoiceInputPath,
  contents: JSON.stringify({
    invoiceId: "01980000-0000-7000-8000-000000000002",
    customer: {
      kind: "new",
      details: {
        kind: "person",
        email: testEmailAddress("confirmation-test-invoice-customer"),
        firstName: "Synthetic",
        lastName: "Customer",
        address: {
          line1: "Test street 1",
          city: "Prague",
          postalCode: "100 00",
          country: "CZ",
        },
      },
    },
    locale: "cs-CZ",
    serviceDate: "2030-01-01",
    payment: { status: "due", date: "2030-01-15" },
    currency: "CZK",
    lines: [{ description: "Synthetic service", price: "1000" }],
  }),
};

// Every command that asks before it runs, one entry per command.
const confirmedCommands: ReadonlyArray<ConfirmedCommand> = [
  {
    args: ["reservations", "cancel", reservationId],
    operation: "administration.cancelReservation",
  },
  {
    args: ["reservations", "backfill-product-details"],
    operation: "administration.backfillReservationProductDetails",
  },
  {
    args: ["reservations", "retry-access", reservationId],
    operation: "administration.mutateReservationAccess.retry-failed",
  },
  {
    args: [
      "reservations",
      "reconcile-access",
      reservationId,
      "--provider-credential-removed",
    ],
    operation:
      "administration.mutateReservationAccess.confirm-provider-credential-removed",
  },
  {
    args: ["invoices", "create", "--input", invoiceInputPath],
    inputFile: invoiceInputFile,
    operation: "administration.createInvoice",
  },
  {
    args: ["invoices", "resend", "01980000-0000-7000-8000-000000000003"],
    operation: "administration.resendInvoice",
  },
  {
    args: [
      "access-codes",
      "create",
      "Confirmation test",
      "--starts-at",
      "2030-01-01T10:00",
      "--ends-at",
      "2030-01-01T11:00",
    ],
    operation: "administration.createStandaloneAccessCode",
  },
  {
    args: ["sessions", "revoke", sessionId],
    operation: "administration.revokeSession",
  },
  {
    args: [
      "administrators",
      "grant",
      "--email",
      testEmailAddress("confirmation-test-new-administrator"),
    ],
    operation: "administrators.grantAdministrator",
  },
  {
    args: ["administrators", "revoke", administratorAccountId],
    operation: "administrators.revokeAdministrator",
    reads: {
      listAdministrators: () => Effect.succeed({ administrators: [] }),
    },
  },
  {
    args: [
      "administrators",
      "backfill-legacy",
      "--legacy-username",
      "legacy-confirmation-test",
      "--email",
      testEmailAddress("confirmation-test-administrator"),
    ],
    operation: "administrators.backfillLegacyAdministrator",
  },
  {
    args: ["campaigns", "audiences", "archive", campaignAudienceId],
    operation: "campaigns.archiveCampaignAudience",
  },
  {
    args: ["campaigns", "audiences", "delete", campaignAudienceId],
    operation: "campaigns.deleteCampaignAudience",
  },
  {
    args: ["campaigns", "delete", campaignId],
    operation: "campaigns.deleteCampaign",
  },
  {
    args: ["campaigns", "send", campaignId, "--code", "synthetic-code"],
    operation: "campaigns.sendCampaign",
    reads: {
      getCampaign: () =>
        Effect.succeed({
          id: campaignId,
          title: "Synthetic campaign",
        } as never),
    },
  },
  {
    args: ["campaigns", "retry", campaignId],
    operation: "campaigns.retryCampaign",
  },
  {
    args: ["automations", "activate", campaignId, "--preview", "preview-test"],
    operation: "automations.activateAutomation",
    reads: {
      getAutomation: () =>
        Effect.succeed({
          activation: { _tag: "PreviewRequired" },
          trigger: null,
        } as never),
    },
  },
  {
    args: ["automations", "pause", campaignId],
    operation: "automations.pauseAutomation",
  },
  {
    args: ["automations", "resume", campaignId],
    operation: "automations.resumeAutomation",
  },
  {
    args: ["automations", "archive", campaignId],
    operation: "automations.archiveAutomation",
  },
  {
    args: ["customers", "set-discount-group", customerId, discountGroupId],
    operation: "administration.mutateDiscounts.set-customer-discount-group",
  },
  {
    args: ["customers", "clear-discount-group", customerId],
    operation: "administration.mutateDiscounts.set-customer-discount-group",
  },
  {
    args: ["discounts", "delete", discountId],
    operation: "administration.mutateDiscounts.delete-discount",
  },
  {
    args: ["codes", "delete", codeId],
    operation: "administration.mutateDiscounts.delete-code",
  },
  {
    args: ["codes", "add-customer", codeId, customerId],
    operation: "administration.mutateDiscounts.add-code-customer",
  },
  {
    args: ["codes", "remove-customer", codeId, customerId],
    operation: "administration.mutateDiscounts.remove-code-customer",
  },
  {
    args: ["codes", "make-unrestricted", codeId],
    operation: "administration.mutateDiscounts.make-code-unrestricted",
  },
  {
    args: ["vouchers", "delete", voucherId],
    operation: "administration.mutateDiscounts.delete-voucher",
  },
  {
    args: ["vouchers", "add-customer", voucherId, customerId],
    operation: "administration.mutateDiscounts.add-voucher-customer",
  },
  {
    args: ["vouchers", "remove-customer", voucherId, customerId],
    operation: "administration.mutateDiscounts.remove-voucher-customer",
  },
  {
    args: ["vouchers", "make-unrestricted", voucherId],
    operation: "administration.mutateDiscounts.make-voucher-unrestricted",
  },
];

const destructiveOperations = administrationOperations(WorkspaceAdminApi)
  .filter(
    ({ access }) =>
      access._tag === "Operation" && access.behavior.kind === "destructive"
  )
  .map(({ reference }) => reference);

/**
 * Runs the command with `--json` and no `--yes`. Any API call other than
 * the listed reads fails the run, so a confirmation can't follow a change.
 */
const runUnconfirmed = ({ args, reads = {} }: ConfirmedCommand) => {
  const calls: Array<string> = [];
  const api = new Proxy({} as Api, {
    get: (_target, method: string) => {
      const read = reads[method as keyof Api];
      return (...parameters: ReadonlyArray<unknown>) => {
        calls.push(method);
        return read
          ? (read as (...input: ReadonlyArray<unknown>) => unknown)(
              ...parameters
            )
          : Effect.die(new Error(`Unexpected API call: ${method}`));
      };
    },
  });
  const layer = Layer.mergeAll(
    Layer.succeed(WorkspaceAdminApiClient, api),
    Layer.succeed(AuthenticationService, {
      current: Effect.succeed(
        Option.some({
          accessToken: Redacted.make(
            Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
          ),
          session: {
            id: sessionId,
            approvedBy: toAdministrationActorName(approverEmail),
            approvedByEmail: approverEmail,
            clientName: "test client",
            cliVersion: "1.3.0",
            buildTarget: "development" as const,
            createdAt: "2026-08-10T10:00:00.000Z",
            lastUsedAt: "2026-08-10T10:00:00.000Z",
            expiresAt: null,
          },
        })
      ),
      save: () => Effect.void,
      clear: Effect.succeed(true),
    }),
    AccessCodeAttemptStore.Default
  ).pipe(
    Layer.provideMerge(
      Layer.succeed(DhwConfig, {
        baseUrl: new URL("https://workspace.example.test"),
        requestHeaders: {},
        isCi: true,
        stateDirectory: `/tmp/dhw-confirmation-test-${crypto.randomUUID()}`,
        updateChecksDisabled: true,
      })
    ),
    Layer.provideMerge(BunServices.layer)
  );

  return Command.runWith(dhwCommand, { version: "1.3.0" })([
    "--json",
    ...args,
  ]).pipe(
    Effect.provide(layer),
    Effect.flip,
    Effect.map((error) => ({ calls, error }))
  );
};

describe("destructive operation confirmation", () => {
  test.each(
    confirmedCommands.map((command) => [command.args.join(" "), command])
  )("dhw %s confirms its operation before calling it", async (_, command) => {
    if (command.inputFile) {
      await Bun.write(command.inputFile.path, command.inputFile.contents);
    }
    try {
      const { calls, error } = await runUnconfirmed(command).pipe(
        Effect.runPromise
      );

      expect(error).toMatchObject({
        _tag: "ConfirmationRequiredError",
        operation: command.operation,
      });
      expect(calls).toEqual(
        calls.filter((method) => command.reads?.[method as keyof Api])
      );
    } finally {
      if (command.inputFile) {
        await Bun.file(command.inputFile.path).delete();
      }
    }
  });

  test("every confirmation guards a destructive operation", () => {
    expect(
      confirmedCommands
        .map(({ operation }) => operation)
        .filter((operation) => !destructiveOperations.includes(operation))
    ).toEqual([]);
  });

  test("every destructive operation has a command that confirms it", () => {
    const confirmed = new Set<string>(
      confirmedCommands.map(({ operation }) => operation)
    );

    expect(
      destructiveOperations.filter((operation) => !confirmed.has(operation))
    ).toEqual([]);
  });
});

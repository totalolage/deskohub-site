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
import {
  type Cause,
  Console,
  Effect,
  Layer,
  Option,
  Queue,
  Redacted,
  Schema,
  Terminal,
} from "effect";
import { Command } from "effect/unstable/cli";
import { AccessCodeAttemptStore } from "./access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { rootCommand, runCommand } from "./command-runtime";
import { DhwConfig } from "./config/dhw-config.service";
import { UpdateError, UpdateService } from "./update/update.service";
import type { AvailableUpdate } from "./update/update-state-store.service";

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

describe("automatic update offer after a command", () => {
  const availableUpdate = {
    version: "9.9.9",
    releaseUrl: "https://github.com/example/dhw/releases/tag/dhw-v9.9.9",
    assetUrl: "https://github.com/example/dhw/releases/download/dhw-v9.9.9/dhw",
    assetDigest: "sha256:0",
    assetSize: 1,
    target: "linux-x64-baseline",
  } satisfies AvailableUpdate;

  type UpdateOfferRun = {
    readonly answer?: "n" | "y";
    readonly check?: Effect.Effect<Option.Option<AvailableUpdate>, UpdateError>;
    readonly isCi?: boolean;
    readonly json?: boolean;
    readonly terminal?: boolean;
  };

  const probeCommand = rootCommand.pipe(
    Command.withSubcommands([
      Command.make("probe", {}, () =>
        runCommand((json) => Console.log(`ran json=${json}`))
      ),
    ])
  );

  const keyPress = (input: string): Terminal.UserInput => ({
    input: Option.some(input),
    key: { name: input, ctrl: false, meta: false, shift: false },
  });

  /** Sets both standard streams' TTY flags for the duration of one run. */
  const withTerminal = async <A>(terminal: boolean, run: () => Promise<A>) => {
    const original = {
      stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
      stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    };
    for (const stream of [process.stdin, process.stdout]) {
      Object.defineProperty(stream, "isTTY", {
        configurable: true,
        value: terminal,
      });
    }
    try {
      return await run();
    } finally {
      for (const [stream, descriptor] of [
        [process.stdin, original.stdin],
        [process.stdout, original.stdout],
      ] as const) {
        if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
        else Reflect.deleteProperty(stream, "isTTY");
      }
    }
  };

  const runProbe = ({
    answer = "y",
    check = Effect.succeed(Option.some(availableUpdate)),
    isCi = false,
    json = false,
    terminal = true,
  }: UpdateOfferRun) => {
    const events: Array<string> = [];
    const layer = Layer.mergeAll(
      Layer.succeed(DhwConfig, {
        baseUrl: new URL("https://workspace.example.test"),
        requestHeaders: {},
        isCi,
        stateDirectory: `/tmp/dhw-update-offer-test-${crypto.randomUUID()}`,
        updateChecksDisabled: false,
      }),
      Layer.succeed(UpdateService, {
        check: (force) => {
          events.push(`check force=${force}`);
          return check;
        },
        install: (update) => {
          events.push(`install ${update.version}`);
          return Effect.void;
        },
      }),
      Layer.succeed(
        Terminal.Terminal,
        Terminal.make({
          columns: Effect.succeed(80),
          rows: Effect.succeed(24),
          readInput: Effect.gen(function* () {
            events.push("prompt");
            const input = yield* Queue.unbounded<
              Terminal.UserInput,
              Cause.Done
            >();
            yield* Queue.offer(input, keyPress(answer));
            return input;
          }),
          readLine: Effect.succeed(""),
          display: () => Effect.void,
        })
      ),
      Layer.succeed(Console.Console, {
        ...globalThis.console,
        log: (...values: ReadonlyArray<unknown>) => {
          events.push(`log ${values.join(" ")}`);
        },
      } satisfies Console.Console)
    ).pipe(Layer.provideMerge(BunServices.layer));

    return withTerminal(terminal, () =>
      Command.runWith(probeCommand, { version: "1.3.0" })([
        ...(json ? ["--json"] : []),
        "probe",
      ]).pipe(Effect.provide(layer), Effect.runPromise)
    ).then(() => events);
  };

  test.each<[string, UpdateOfferRun]>([
    ["under --json", { json: true }],
    ["in CI", { isCi: true }],
    ["without a terminal", { terminal: false }],
  ])("doesn't check for an update %s", async (_, run) => {
    const events = await runProbe(run);

    expect(events).toEqual([`log ran json=${run.json === true}`]);
  });

  test("installs the available update when the user accepts", async () => {
    expect(await runProbe({ answer: "y" })).toEqual([
      "log ran json=false",
      "check force=false",
      "prompt",
      "install 9.9.9",
      expect.stringMatching(/^log .*9\.9\.9/),
    ]);
  });

  test("keeps the current version when the user declines", async () => {
    expect(await runProbe({ answer: "n" })).toEqual([
      "log ran json=false",
      "check force=false",
      "prompt",
    ]);
  });

  test.each<[string, UpdateOfferRun["check"]]>([
    ["no update is available", Effect.succeed(Option.none())],
    [
      "the update check fails",
      Effect.fail(
        new UpdateError({ message: "GitHub is unavailable.", cause: null })
      ),
    ],
  ])("doesn't prompt when %s", async (_, check) => {
    expect(await runProbe({ check })).toEqual([
      "log ran json=false",
      "check force=false",
    ]);
  });
});

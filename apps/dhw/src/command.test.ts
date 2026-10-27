import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationActorEmail,
  AdministrationCustomerReservationActivity,
  AdministrationDiscountCodeId,
  AdministrationDiscountGroupList,
  AdministrationDotyposCustomerId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceCreationDefaults,
  AdministrationLegacyUsername,
  AdministrationOverview,
  AdministrationReservationActivity,
  type AdministrationReservationDetailType,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  type AdministrationStandaloneAccessCodeCreateInputType,
  AdministrationStandaloneAccessCodeCreationOutcome,
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeName,
  AdministrationVoucherId,
  AdministrationWorkspaceReservationId,
  CliAccessToken,
  type CliAccessTokenType,
  CliMutationRejected,
  CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionId,
  type CliSessionType,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  toAdministrationActorName,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { AccessCodeAttemptStore } from "./access-codes/access-code-attempt-store.service";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

const syntheticEmail = testEmailAddress("synthetic");

const previewInvoiceInput = Schema.decodeUnknownSync(
  AdministrationInvoiceCreateInput
)({
  invoiceId: "01980000-0000-7000-8000-000000000019",
  customer: {
    kind: "new",
    details: {
      kind: "person",
      email: syntheticEmail,
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
  serviceDate: "2026-08-10",
  payment: { status: "due", date: "2026-08-24" },
  currency: "CZK",
  lines: [{ description: "Synthetic service", price: "1000" }],
});

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const sessionId = Schema.decodeUnknownSync(CliSessionId)(
  "01980000-0000-7000-8000-000000000000"
);
const codeId = Schema.decodeUnknownSync(AdministrationDiscountCodeId)(
  "01980000-0000-7000-8000-000000000001"
);
const voucherId = Schema.decodeUnknownSync(AdministrationVoucherId)(
  "01980000-0000-7000-8000-000000000002"
);
const reservationId = Schema.decodeUnknownSync(
  AdministrationWorkspaceReservationId
)("reservation-test");
const cleanupTargetAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000043");
const cleanupTarget = {
  attemptId: cleanupTargetAttemptId,
  name: Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeName)(
    "Booth A"
  ),
};
const session = {
  id: sessionId,
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
};
const accountApproverEmail = AdministrationActorEmail.make(
  testEmailAddress("admin")
);
const accountApprover = {
  approvedBy: toAdministrationActorName(accountApproverEmail),
  approvedByEmail: accountApproverEmail,
};
const createdAccessCodeOutcome = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreationOutcome
)({
  outcome: "created",
  attemptId: "01980000-0000-7000-8000-000000000042",
  providerCredentialId: "pin-1",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
  pin: "7654321",
}) satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;
const alreadyCreatedAccessCodeOutcome = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreationOutcome
)({
  outcome: "already-created",
  attemptId: "01980000-0000-7000-8000-000000000042",
  providerCredentialId: "pin-1",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
}) satisfies AdministrationStandaloneAccessCodeCreationOutcomeType;

describe("dhw mutation commands", () => {
  test("requires reauthentication before a legacy session can create invoices", async () => {
    const { layer } = makeCommandLayer();

    const error = await runCommand(
      ["--json", "invoices", "create", "--input", "invoice.json", "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "AuthenticationRequiredError",
      message: expect.stringContaining("dhw auth"),
    });
  });

  test("reuses the invoice id from the input file across create retries", async () => {
    const invoiceId = "01980000-0000-7000-8000-000000000009";
    const inputPath = `/tmp/dhw-invoice-${crypto.randomUUID()}.json`;
    const creations: unknown[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          creations.push(input);
          return {
            invoiceId: input.invoiceId,
            invoiceNumber: "WS-FV-2026-000001",
            changed: true,
            needsAttention: false,
          };
        }),
    });
    await Bun.write(
      inputPath,
      JSON.stringify({
        invoiceId,
        customer: {
          kind: "new",
          details: {
            kind: "person",
            email: syntheticEmail,
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
        serviceDate: "2026-08-10",
        payment: { status: "due", date: "2026-08-24" },
        currency: "CZK",
        lines: [{ description: "Space rental", price: "1000" }],
      })
    );

    try {
      const args = [
        "--json",
        "invoices",
        "create",
        "--input",
        inputPath,
        "--yes",
      ];
      await runCommand(args, layer).pipe(Effect.runPromise);
      await runCommand(args, layer).pipe(Effect.runPromise);
    } finally {
      await Bun.file(inputPath).delete();
    }

    expect(creations).toHaveLength(2);
    expect(creations).toEqual([
      expect.objectContaining({ invoiceId }),
      expect.objectContaining({ invoiceId }),
    ]);
  });

  test("previews an invoice from a strict input file and writes the PDF", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dhw-command-invoice-"));
    const inputPath = join(directory, "invoice.json");
    const outputPath = join(directory, "preview.pdf");
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const previews: unknown[] = [];
    const { layer, output } = makeCommandLayer({
      previewInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          previews.push(input);
          return pdf;
        }),
    });
    await writeFile(inputPath, JSON.stringify(previewInvoiceInput));

    try {
      await runCommand(
        [
          "--json",
          "invoices",
          "preview",
          "--input",
          inputPath,
          "--output",
          outputPath,
        ],
        layer
      ).pipe(Effect.runPromise);

      expect(previews).toEqual([previewInvoiceInput]);
      expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
      expect(JSON.parse(output.join(""))).toEqual({
        invoiceId: previewInvoiceInput.invoiceId,
        path: outputPath,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invoice preview input with an unknown property before the API call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dhw-command-invoice-"));
    const inputPath = join(directory, "invoice.json");
    const previews: unknown[] = [];
    const { layer } = makeCommandLayer({
      previewInvoice: (_accessToken, input) =>
        Effect.sync(() => {
          previews.push(input);
          return new Uint8Array();
        }),
    });
    await writeFile(
      inputPath,
      JSON.stringify({ ...previewInvoiceInput, unknownProperty: true })
    );

    try {
      const error = await runCommand(
        ["--json", "invoices", "preview", "--input", inputPath],
        layer
      ).pipe(Effect.flip, Effect.runPromise);

      expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
      expect(previews).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("prints invoice creation defaults as JSON", async () => {
    const defaults = Schema.decodeUnknownSync(
      AdministrationInvoiceCreationDefaults
    )({
      currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
      defaultCurrency: "CZK",
      defaultServiceDate: "2026-08-10",
      defaultDueDate: "2026-08-24",
      suggestedVariableSymbol: "260810",
    });
    const { layer, output } = makeCommandLayer({
      getInvoiceCreationDefaults: () => Effect.succeed(defaults),
    });

    await runCommand(["--json", "invoices", "defaults"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(defaults);
  });

  test("passes a decoded customer ID to the activity command and prints its JSON", async () => {
    const customerId = "customer-1";
    const decodedCustomerId = Schema.decodeUnknownSync(
      AdministrationDotyposCustomerId
    )(customerId);
    const activity = Schema.decodeUnknownSync(
      AdministrationCustomerReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2, category: "meeting-room" }],
    });
    const requestedCustomerIds: AdministrationDotyposCustomerId[] = [];
    const { layer, output } = makeCommandLayer({
      getCustomerReservationActivity: (_accessToken, decodedCustomerId) =>
        Effect.sync(() => {
          requestedCustomerIds.push(decodedCustomerId);
          return activity;
        }),
    });

    await runCommand(
      ["--json", "customers", "activity", customerId],
      layer
    ).pipe(Effect.runPromise);

    expect(requestedCustomerIds).toEqual([decodedCustomerId]);
    expect(JSON.parse(output.join(""))).toEqual(activity);
  });

  test("prints global reservation activity as JSON", async () => {
    const activity = Schema.decodeUnknownSync(
      AdministrationReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2 }],
    });
    const { layer, output } = makeCommandLayer({
      getReservationActivity: () => Effect.succeed(activity),
    });

    await runCommand(["--json", "reservations", "activity"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(activity);
  });

  test("prints unavailable global reservation activity for people", async () => {
    const activity = Schema.decodeUnknownSync(
      AdministrationReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: null,
    });
    const { layer, output } = makeCommandLayer({
      getReservationActivity: () => Effect.succeed(activity),
    });

    await runCommand(["reservations", "activity"], layer).pipe(
      Effect.runPromise
    );

    expect(output.join("")).toBe(
      "Reservation activity 2026-08-01 to 2026-08-02: unavailable"
    );
  });

  test("includes refund attention in overview JSON", async () => {
    const overview = Schema.decodeUnknownSync(AdministrationOverview)({
      today: { completed: 1, unavailable: false, value: 2 },
      upcoming: { completed: 3, unavailable: false, value: 4 },
      lastSevenDays: { completed: 5, unavailable: false, value: 6 },
      uniqueCustomers: {
        customers: [],
        unavailable: false,
        value: 7,
      },
      newCustomers: {
        customers: [],
        unavailable: false,
        value: 8,
      },
      refundAttention: { unavailable: false, value: 9 },
    });
    const { layer, output } = makeCommandLayer({
      getOverview: () => Effect.succeed(overview),
    });

    await runCommand(["--json", "overview"], layer).pipe(Effect.runPromise);

    expect(JSON.parse(output.join("")).refundAttention).toEqual(
      overview.refundAttention
    );
  });

  test("requires explicit confirmation for non-interactive revocation", async () => {
    let revocations = 0;
    const { layer } = makeCommandLayer({
      revokeSession: () =>
        Effect.sync(() => {
          revocations += 1;
          return { changed: true };
        }),
    });

    const error = await runCommand(
      ["--json", "sessions", "revoke", sessionId],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(revocations).toBe(0);
  });

  test("confirms reservation cancellation and forwards the email choice", async () => {
    const cancellations: unknown[] = [];
    const { layer } = makeCommandLayer({
      cancelReservation: (_accessToken, id, input) =>
        Effect.sync(() => {
          cancellations.push({ id, input });
          return { outcome: "cancelled", email: "sent" } as const;
        }),
    });

    await runCommand(
      [
        "--json",
        "reservations",
        "cancel",
        reservationId,
        "--confirm-access-credential-removed",
        "--force",
        "--send-cancellation-email",
        "--yes",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(cancellations).toEqual([
      {
        id: reservationId,
        input: {
          accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
          force: true,
          providerCredentialRemoved: true,
          sendCancellationEmail: true,
        },
      },
    ]);
  });

  test("shows who booked a reservation for someone else", async () => {
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);
    const detail = (author: AdministrationReservationDetailType["author"]) =>
      ({
        author,
        accessGrant: null,
        discounts: [],
        orders: [],
        paymentAttempts: [],
        reservation: {
          id: reservationId,
          customerId: "booked-for-customer",
          customer: null,
          date: "2026-08-10",
          startsAt: null,
          typeLabel: "Cowork",
          status: { label: "Held" },
        },
      }) as unknown as AdministrationReservationDetailType;

    for (const author of [
      {
        kind: "account" as const,
        customerId: null,
        displayName: "Ada Author",
        email: testEmailAddress("ada-author"),
      },
      { kind: "deleted" as const },
      { kind: "unavailable" as const },
      null,
    ]) {
      const { layer } = makeCommandLayer({
        getReservation: () => Effect.succeed(detail(author)),
      });
      await runCommand(
        ["reservations", "get", reservationId],
        Layer.mergeAll(layer, capturedOutput)
      ).pipe(Effect.runPromise);
    }

    expect(output.filter((line) => line.startsWith("Booked by"))).toEqual([
      `Booked by: Ada Author <${testEmailAddress("ada-author")}>`,
      "Booked by: deleted account",
      "Booked by: unavailable",
    ]);
  });

  test("shows when an early-setup meeting room is held from", async () => {
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);
    const detail = (setupStartsAt: string | null) =>
      ({
        author: null,
        accessGrant: null,
        discounts: [],
        orders: [],
        paymentAttempts: [],
        reservation: {
          id: reservationId,
          customerId: "meeting-room-customer",
          customer: null,
          date: "2026-08-10",
          startsAt: "2026-08-10T08:00:00Z",
          endsAt: "2026-08-10T09:00:00Z",
          setupStartsAt,
          typeLabel: "Meeting Room",
          status: { label: "Paid" },
        },
      }) as unknown as AdministrationReservationDetailType;

    for (const setupStartsAt of ["2026-08-10T07:45:00Z", null]) {
      const { layer } = makeCommandLayer({
        getReservation: () => Effect.succeed(detail(setupStartsAt)),
      });
      await runCommand(
        ["reservations", "get", reservationId],
        Layer.mergeAll(layer, capturedOutput)
      ).pipe(Effect.runPromise);
    }

    expect(output.filter((line) => line.startsWith("Early setup"))).toEqual([
      "Early setup: from 2026-08-10T07:45:00Z, booked 2026-08-10T08:00:00Z to 2026-08-10T09:00:00Z",
    ]);
  });

  test("dry-runs the product-details backfill across every batch without confirmation", async () => {
    const requests: unknown[] = [];
    const nextReservationId = Schema.decodeUnknownSync(
      AdministrationWorkspaceReservationId
    )("reservation-next");
    const { layer } = makeCommandLayer({
      backfillReservationProductDetails: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return input.after === null
            ? {
                updated: 2,
                alreadyComplete: 1,
                unresolved: [
                  {
                    reservationId,
                    family: "office" as const,
                    reason: "dotypos_seats_invalid" as const,
                  },
                ],
                nextCursor: nextReservationId,
              }
            : {
                updated: 1,
                alreadyComplete: 3,
                unresolved: [],
                nextCursor: null,
              };
        }),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      ["--json", "reservations", "backfill-product-details", "--dry-run"],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(requests).toEqual([
      { dryRun: true, after: null },
      { dryRun: true, after: nextReservationId },
    ]);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      {
        dryRun: true,
        updated: 3,
        alreadyComplete: 4,
        unresolved: [
          {
            reservationId,
            family: "office",
            reason: "dotypos_seats_invalid",
          },
        ],
      },
    ]);
  });

  test("requires confirmation before the product-details backfill writes", async () => {
    const requests: unknown[] = [];
    const { layer } = makeCommandLayer({
      backfillReservationProductDetails: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return {
            updated: 0,
            alreadyComplete: 0,
            unresolved: [],
            nextCursor: null,
          };
        }),
    });

    const error = await runCommand(
      ["--json", "reservations", "backfill-product-details"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(requests).toEqual([]);

    await runCommand(
      ["--json", "reservations", "backfill-product-details", "--yes"],
      layer
    ).pipe(Effect.runPromise);
    expect(requests).toEqual([{ dryRun: false, after: null }]);
  });

  test("dry-runs a legacy administrator backfill and prints its JSON result", async () => {
    const legacyUsername = AdministrationLegacyUsername.make("legacy-admin");
    const email = testEmailAddress("legacy-admin");
    const requests: unknown[] = [];
    const result = {
      dryRun: true,
      administratorRole: "granted" as const,
      cliSessions: { linked: 2, alreadyLinked: 1, linkedToOtherAccount: 3 },
      manualInvoices: { linked: 4, alreadyLinked: 5, linkedToOtherAccount: 6 },
      standaloneAccessCodeEvents: {
        linked: 7,
        alreadyLinked: 8,
        linkedToOtherAccount: 9,
      },
    };
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return result;
        }),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      [
        "--json",
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        legacyUsername,
        "--email",
        email,
        "--dry-run",
      ],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(requests).toEqual([{ legacyUsername, email, dryRun: true }]);
    expect(output.map((line) => JSON.parse(line))).toEqual([result]);
  });

  test("requires confirmation for a real legacy administrator backfill", async () => {
    const legacyUsername = AdministrationLegacyUsername.make("legacy-admin");
    const email = testEmailAddress("legacy-admin");
    const requests: unknown[] = [];
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: (_accessToken, input) =>
        Effect.sync(() => {
          requests.push(input);
          return {
            dryRun: false,
            administratorRole: "granted" as const,
            cliSessions: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
            manualInvoices: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
            standaloneAccessCodeEvents: {
              linked: 1,
              alreadyLinked: 0,
              linkedToOtherAccount: 0,
            },
          };
        }),
    });
    const args = [
      "--json",
      "administrators",
      "backfill-legacy",
      "--legacy-username",
      legacyUsername,
      "--email",
      email,
    ];

    const error = await runCommand(args, layer).pipe(
      Effect.flip,
      Effect.runPromise
    );
    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(requests).toEqual([]);

    await runCommand([...args, "--yes"], layer).pipe(Effect.runPromise);
    expect(requests).toEqual([{ legacyUsername, email, dryRun: false }]);
  });

  test("formats legacy administrator backfill counts for operators", async () => {
    const result = {
      dryRun: true,
      administratorRole: "already_granted" as const,
      cliSessions: { linked: 2, alreadyLinked: 1, linkedToOtherAccount: 3 },
      manualInvoices: { linked: 4, alreadyLinked: 5, linkedToOtherAccount: 6 },
      standaloneAccessCodeEvents: {
        linked: 7,
        alreadyLinked: 8,
        linkedToOtherAccount: 9,
      },
    };
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: () => Effect.succeed(result),
    });
    const output: string[] = [];
    const capturedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(args.join(" "));
      },
    } satisfies Console.Console);

    await runCommand(
      [
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        "legacy-admin",
        "--email",
        testEmailAddress("legacy-admin"),
        "--dry-run",
      ],
      Layer.mergeAll(layer, capturedOutput)
    ).pipe(Effect.runPromise);

    expect(output).toEqual([
      "Administrator role: already granted",
      "CLI sessions: would link 2, already linked 1, linked to another account 3",
      "Manual invoices: would link 4, already linked 5, linked to another account 6",
      "Standalone access-code events: would link 7, already linked 8, linked to another account 9",
    ]);
  });

  test("propagates CliResourceNotFound from legacy administrator backfill", async () => {
    const notFound = new CliResourceNotFound({
      message: "No active account has that email.",
    });
    const { layer } = makeCommandLayer({
      backfillLegacyAdministrator: () => Effect.fail(notFound),
    });

    const error = await runCommand(
      [
        "--json",
        "administrators",
        "backfill-legacy",
        "--legacy-username",
        "legacy-admin",
        "--email",
        testEmailAddress("legacy-admin"),
        "--dry-run",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toBe(notFound);
  });

  test("clears the local credential after revoking its own session", async () => {
    let clears = 0;
    const { layer } = makeCommandLayer({
      clear: Effect.sync(() => {
        clears += 1;
        return true;
      }),
      revokeSession: () => Effect.succeed({ changed: true }),
    });

    await runCommand(
      ["--json", "sessions", "revoke", sessionId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(clears).toBe(1);
  });

  test("requires reauthentication before a legacy session can create access codes", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "AuthenticationRequiredError",
      message: expect.stringContaining("dhw auth"),
    });
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("requires explicit confirmation before requesting an access code", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
    });

    const jsonError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const plainError = await runCommand(
      [
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(jsonError).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(plainError).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("rejects an invalid access window before any API call", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
    });

    const reversedError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T12:00",
        "--ends-at",
        "2026-09-10T10:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const parseError = await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:30",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(reversedError).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(parseError).toBeDefined();
    expect(accessCodeCreations).toHaveLength(0);
  });

  test("reserves a fresh valid attempt id after each concluded creation and forwards the decoded request", async () => {
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: () =>
        Effect.succeed(createdAccessCodeOutcome),
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "  Booth A  ",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(accessCodeCreations).toHaveLength(2);
    for (const creation of accessCodeCreations) {
      expect(
        Schema.is(AdministrationStandaloneAccessCodeAttemptId)(
          creation.attemptId
        )
      ).toBe(true);
      expect(JSON.stringify(creation.input)).toBe(
        JSON.stringify({
          name: "Booth A",
          startsAt: "2026-09-10T10:00",
          endsAt: "2026-09-10T12:00",
        })
      );
    }
    expect(accessCodeCreations[0]?.attemptId).not.toBe(
      accessCodeCreations[1]?.attemptId
    );
  });

  test("resumes a lost access-code creation with the reserved attempt id", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    let responseLost = true;
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return responseLost
          ? Effect.fail(
              new CliServiceUnavailable({ message: "The response was lost." })
            )
          : Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    responseLost = false;
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).toBe(attemptIds[0]);
  });

  test("keeps the reserved attempt id recoverable when the PIN output is interrupted", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return attemptIds.length === 1
          ? Effect.succeed(createdAccessCodeOutcome)
          : Effect.succeed(alreadyCreatedAccessCodeOutcome);
      },
    });
    const interruptedOutput = Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => {
        if (args.join(" ").includes("7654321")) {
          throw new Error(
            "The output was interrupted before the PIN was shown."
          );
        }
      },
    } satisfies Console.Console);
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    const interrupted = await runCommand(
      args,
      Layer.mergeAll(layer, interruptedOutput)
    ).pipe(Effect.exit, Effect.runPromise);
    expect(Exit.isFailure(interrupted)).toBe(true);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).toBe(attemptIds[0]);
  });

  test("does not reuse a reserved attempt id for a changed access window", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliServiceUnavailable({ message: "The response was lost." })
        );
      },
    });

    await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T12:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    await runCommand(
      [
        "--json",
        "access-codes",
        "create",
        "Booth A",
        "--starts-at",
        "2026-09-10T10:00",
        "--ends-at",
        "2026-09-10T13:00",
        "--yes",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("reserves a fresh attempt id after a terminally rejected access-code creation", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliMutationRejected({ message: "The request was rejected." })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("reserves a fresh attempt id after an uncertain provider outcome", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliMutationUncertain({
            message: "The creation outcome is ambiguous.",
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("refuses to create an access code when the attempt cannot be reserved locally", async () => {
    const blockedPath = `/tmp/dhw-state-blocked-${crypto.randomUUID()}`;
    await Bun.write(blockedPath, "a regular file, not a state directory");
    const { accessCodeCreations, layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      stateDirectory: blockedPath,
    });

    try {
      const error = await runCommand(
        [
          "--json",
          "access-codes",
          "create",
          "Booth A",
          "--starts-at",
          "2026-09-10T10:00",
          "--ends-at",
          "2026-09-10T12:00",
          "--yes",
        ],
        layer
      ).pipe(Effect.flip, Effect.runPromise);

      expect(error).toMatchObject({
        _tag: "AccessCodeAttemptReservationError",
      });
      expect(accessCodeCreations).toHaveLength(0);
    } finally {
      await Bun.file(blockedPath).delete();
    }
  });

  test("reserves a fresh attempt id after required at-lock cleanup", async () => {
    const attemptIds: AdministrationStandaloneAccessCodeAttemptIdType[] = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        attemptIds.push(attemptId);
        return Effect.fail(
          new CliStandaloneAccessCodeCleanupRequired({
            message: "A previous attempt for this window is ambiguous.",
            cleanupTarget,
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).not.toBe(attemptIds[0]);
  });

  test("completes a confirmed reconciliation in one invocation after a lost response", async () => {
    const calls: Array<{
      readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (
        _accessToken,
        attemptId,
        _input,
        providerCredentialRemovedAttemptId
      ) => {
        calls.push({ attemptId, providerCredentialRemovedAttemptId });
        if (calls.length === 1) {
          return Effect.fail(
            new CliStandaloneAccessCodeReconciled({
              message:
                "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code.",
            })
          );
        }
        return Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.providerCredentialRemovedAttemptId).toBe(
      cleanupTargetAttemptId
    );
    expect(calls[1]?.providerCredentialRemovedAttemptId).toBeUndefined();
    expect(calls[1]?.attemptId).not.toBe(calls[0]?.attemptId);
    expect(calls[0]?.attemptId).not.toBe(cleanupTargetAttemptId);
    expect(calls[1]?.attemptId).not.toBe(cleanupTargetAttemptId);
  });

  test("forgets the rotated attempt so the next intentional command reserves a fresh id", async () => {
    const calls: Array<{
      readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (_accessToken, attemptId) => {
        calls.push({ attemptId });
        if (calls.length === 1) {
          return Effect.fail(
            new CliStandaloneAccessCodeReconciled({
              message:
                "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code.",
            })
          );
        }
        return Effect.succeed(createdAccessCodeOutcome);
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.runPromise);
    await runCommand(args, layer).pipe(Effect.runPromise);

    expect(calls).toHaveLength(3);
    expect(calls[1]?.attemptId).not.toBe(calls[0]?.attemptId);
    expect(calls[2]?.attemptId).not.toBe(calls[1]?.attemptId);
    expect(calls[2]?.attemptId).not.toBe(calls[0]?.attemptId);
  });

  test("never rotates on a plain uncertain outcome", async () => {
    const calls: Array<{
      readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
    }> = [];
    const { layer } = makeCommandLayer({
      authenticatedSession: {
        ...session,
        ...accountApprover,
      },
      createStandaloneAccessCode: (
        _accessToken,
        _attemptId,
        _input,
        providerCredentialRemovedAttemptId
      ) => {
        calls.push({ providerCredentialRemovedAttemptId });
        return Effect.fail(
          new CliMutationUncertain({
            message: "The creation outcome is ambiguous.",
          })
        );
      },
    });
    const args = [
      "--json",
      "access-codes",
      "create",
      "Booth A",
      "--starts-at",
      "2026-09-10T10:00",
      "--ends-at",
      "2026-09-10T12:00",
      "--provider-credential-removed",
      cleanupTargetAttemptId,
      "--yes",
    ];

    await runCommand(args, layer).pipe(Effect.flip, Effect.runPromise);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.providerCredentialRemovedAttemptId).toBe(
      cleanupTargetAttemptId
    );
  });

  test("requires confirmation and provider cleanup before reconciling access", async () => {
    const { accessMutations, layer } = makeCommandLayer();

    const confirmationError = await runCommand(
      ["--json", "reservations", "retry-access", "reservation-1"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);
    const providerError = await runCommand(
      ["--json", "reservations", "reconcile-access", "reservation-1", "--yes"],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(confirmationError).toMatchObject({
      _tag: "ConfirmationRequiredError",
    });
    expect(providerError).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(accessMutations).toHaveLength(0);
  });

  test("prints discount groups as the API result in JSON mode", async () => {
    const discountGroups = Schema.decodeUnknownSync(
      AdministrationDiscountGroupList
    )({ discountGroups: [{ id: "group-1", name: "Community" }] });
    const { layer, output } = makeCommandLayer({
      listDiscountGroups: () => Effect.succeed(discountGroups),
    });

    await runCommand(["--json", "discounts", "groups"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual(discountGroups.discountGroups);
  });

  test("rejects percentages that cannot be represented as whole basis points", async () => {
    const { layer, mutations } = makeCommandLayer();

    await expect(
      runCommand(
        [
          "--json",
          "discounts",
          "create",
          "percentage",
          "--label-en",
          "Summer",
          "--label-cs",
          "Léto",
          "--percentage",
          "0.015",
          "--product",
          "cowork",
        ],
        layer
      ).pipe(Effect.runPromise)
    ).rejects.toBeDefined();

    expect(mutations).toHaveLength(0);
  });

  test("maps exact percentages and validates the complete mutation", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "0.01",
        "--product",
        "cowork",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: { kind: "percentage", basisPoints: 1 },
          products: [{ kind: "cowork" }],
        },
      },
    ]);
  });

  test("rejects every cowork tier combined with a single tier before making a request", async () => {
    const { layer, mutations } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "10",
        "--product",
        "cowork",
        "--product",
        "cowork:open-space",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(mutations).toHaveLength(0);
  });

  test("rejects duplicate product flags before making a request", async () => {
    const { layer, mutations } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Summer",
        "--label-cs",
        "Léto",
        "--percentage",
        "10",
        "--product",
        "cowork",
        "--product",
        "cowork",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({ _tag: "InvalidMutationInputError" });
    expect(mutations).toHaveLength(0);
  });
});

const runCommand = <R>(
  args: ReadonlyArray<string>,
  layer: Layer.Layer<R, never, never>
) =>
  Command.runWith(dhwCommand, { version: "1.3.0" })(args).pipe(
    Effect.provide(layer)
  );

const makeCommandLayer = ({
  backfillLegacyAdministrator = () => Effect.die("not used"),
  backfillReservationProductDetails = () => Effect.die("not used"),
  cancelReservation = () =>
    Effect.succeed({ outcome: "already_cancelled", email: "not_requested" }),
  clear = Effect.succeed(true),
  createInvoice = () => Effect.die("not used"),
  createStandaloneAccessCode = () => Effect.die("not used"),
  getCustomerReservationActivity = () => Effect.die("not used"),
  getReservationActivity = () => Effect.die("not used"),
  getInvoiceCreationDefaults = () => Effect.die("not used"),
  getOverview = () => Effect.die("not used"),
  listDiscountGroups = () => Effect.die("not used"),
  previewInvoice = () => Effect.die("not used"),
  getReservation = () =>
    Effect.succeed({
      accessGrant: { updatedAt: "2026-08-10T10:00:00.000Z" },
    } as never),
  authenticatedSession = session,
  revokeSession = () => Effect.succeed({ changed: false }),
  stateDirectory = `/tmp/dhw-command-test-${crypto.randomUUID()}`,
}: {
  readonly backfillLegacyAdministrator?: WorkspaceAdminApiClient["Service"]["backfillLegacyAdministrator"];
  readonly backfillReservationProductDetails?: WorkspaceAdminApiClient["Service"]["backfillReservationProductDetails"];
  readonly cancelReservation?: WorkspaceAdminApiClient["Service"]["cancelReservation"];
  readonly clear?: AuthenticationService["Service"]["clear"];
  readonly createInvoice?: WorkspaceAdminApiClient["Service"]["createInvoice"];
  readonly createStandaloneAccessCode?: WorkspaceAdminApiClient["Service"]["createStandaloneAccessCode"];
  readonly getCustomerReservationActivity?: WorkspaceAdminApiClient["Service"]["getCustomerReservationActivity"];
  readonly getReservationActivity?: WorkspaceAdminApiClient["Service"]["getReservationActivity"];
  readonly getInvoiceCreationDefaults?: WorkspaceAdminApiClient["Service"]["getInvoiceCreationDefaults"];
  readonly getOverview?: WorkspaceAdminApiClient["Service"]["getOverview"];
  readonly listDiscountGroups?: WorkspaceAdminApiClient["Service"]["listDiscountGroups"];
  readonly previewInvoice?: WorkspaceAdminApiClient["Service"]["previewInvoice"];
  readonly getReservation?: WorkspaceAdminApiClient["Service"]["getReservation"];
  readonly authenticatedSession?: CliSessionType;
  readonly revokeSession?: WorkspaceAdminApiClient["Service"]["revokeSession"];
  readonly stateDirectory?: string;
} = {}) => {
  const mutations: unknown[] = [];
  const accessMutations: unknown[] = [];
  const accessCodeCreations: Array<{
    readonly accessToken: Redacted.Redacted<CliAccessTokenType>;
    readonly attemptId: AdministrationStandaloneAccessCodeAttemptIdType;
    readonly input: AdministrationStandaloneAccessCodeCreateInputType;
    readonly providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType;
  }> = [];
  const output: string[] = [];
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    backfillLegacyAdministrator,
    backfillReservationProductDetails,
    cancelReservation,
    createInvoice,
    createStandaloneAccessCode: (
      accessToken: Redacted.Redacted<CliAccessTokenType>,
      attemptId: AdministrationStandaloneAccessCodeAttemptIdType,
      input: AdministrationStandaloneAccessCodeCreateInputType,
      providerCredentialRemovedAttemptId?: AdministrationStandaloneAccessCodeAttemptIdType
    ) =>
      Effect.suspend(() => {
        accessCodeCreations.push({
          accessToken,
          attemptId,
          input,
          providerCredentialRemovedAttemptId,
        });
        return createStandaloneAccessCode(
          accessToken,
          attemptId,
          input,
          providerCredentialRemovedAttemptId
        );
      }),
    getCustomerReservationActivity,
    getReservationActivity,
    getInvoiceCreationDefaults,
    getOverview,
    getReservation,
    listDiscountGroups,
    mutateDiscounts: (_accessToken, _requestId, mutation) =>
      Effect.sync(() => {
        mutations.push(mutation);
        return {
          kind: mutation.kind,
          createdDiscountId: null,
          createdCodeId:
            mutation.kind === "create-code" ||
            mutation.kind === "create-customer-code"
              ? codeId
              : null,
          createdVoucherId:
            mutation.kind === "create-voucher" ||
            mutation.kind === "create-customer-voucher"
              ? voucherId
              : null,
        };
      }),
    mutateReservationAccess: (
      _accessToken,
      _requestId,
      reservationId,
      mutation
    ) =>
      Effect.sync(() => {
        accessMutations.push([reservationId, mutation]);
        const timestamp = "2026-08-10T10:00:00.000Z";
        return {
          id: "access-1",
          state: "issued" as const,
          provider: "igloohome",
          credentialType: "algopin-hourly",
          deviceId: "EK1X16f8898a",
          providerCredentialId: "pin-1",
          accessName: `Deskohub ${reservationId}`,
          scheduledStartsAt: timestamp,
          startsAt: timestamp,
          endsAt: timestamp,
          provisioningStartedAt: timestamp,
          issuedAt: timestamp,
          failedAt: null,
          failureCode: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }),
    previewInvoice,
    revokeSession,
  });
  const console = Layer.succeed(Console.Console, {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      output.push(args.join(" "));
    },
  } satisfies Console.Console);
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({
        accessToken: Redacted.make(accessToken),
        session: authenticatedSession,
      })
    ),
    save: () => Effect.void,
    clear,
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory,
    updateChecksDisabled: true,
  });

  return {
    accessCodeCreations,
    accessMutations,
    mutations,
    layer: Layer.mergeAll(
      api,
      authentication,
      console,
      AccessCodeAttemptStore.Default
    ).pipe(Layer.provideMerge(config), Layer.provideMerge(BunServices.layer)),
    output,
  };
};

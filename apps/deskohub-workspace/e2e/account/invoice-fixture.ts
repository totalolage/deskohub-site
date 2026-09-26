import "../../shared/polyfills/temporal";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { invoices } from "@/db/schema";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { encryptAccountingSnapshot } from "@/features/accounting/backend/accounting-snapshot-sql";
import {
  formatInvoiceNumber,
  type InvoiceNumber,
  type ManualInvoiceDocument,
  makeManualInvoiceDocument,
} from "@/features/accounting/invoice";
import {
  manualInvoiceInputSchema,
  normalizeManualInvoiceInput,
} from "@/features/accounting/manual-invoice";
import type { DatabaseClient } from "../../db/database-client";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";

/**
 * Issued synthetic invoices live in a dedicated numbering year and carry an
 * opaque customer-tagged number so fixtures never collide with the real
 * numbering sequence and are findable for cleanup convergence checks.
 */
const fixtureNumberingYear = 2099;

export type WorkspaceE2ECustomerInvoiceFixtureInput = {
  readonly customerId: DotyposCustomerId;
  /**
   * The preview-branch accounting snapshot key: the fixture encrypts the
   * synthetic document with exactly the key material the deployed app reads.
   */
  readonly snapshotKey: {
    readonly id: string;
    readonly secret: string;
  };
};

export type WorkspaceE2ECustomerInvoiceFixture = {
  readonly document: ManualInvoiceDocument;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly pdfPath: string;
  /**
   * Deletes the issued invoice row and verifies the download is denied
   * afterwards; idempotent with the release-time cleanup.
   */
  readonly revoke: () => Effect.Effect<void, WorkspaceE2EError>;
};

type WorkspaceE2ECustomerInvoiceDatabase = {
  readonly findInvoice: (
    invoiceId: string
  ) => Effect.Effect<readonly { readonly id: string }[], unknown>;
  readonly insertInvoice: (
    row: typeof invoices.$inferInsert
  ) => Effect.Effect<unknown, unknown>;
  readonly revokeInvoice: (
    invoiceId: string
  ) => Effect.Effect<unknown, unknown>;
};

type WorkspaceE2ECustomerInvoiceFixtureDependencies = {
  readonly database?: WorkspaceE2ECustomerInvoiceDatabase;
};

export type WorkspaceE2ECustomerInvoiceFixtureTestDependencies =
  Required<WorkspaceE2ECustomerInvoiceFixtureDependencies>;

const makeFixtureInvoiceIds = (): {
  readonly invoiceId: string;
  readonly invoiceNumber: InvoiceNumber;
} => {
  const invoiceId = crypto.randomUUID();
  const sequence =
    900000000 +
    (Number.parseInt(crypto.randomUUID().slice(0, 12).replaceAll("-", ""), 16) %
      90000000);
  return {
    invoiceId,
    invoiceNumber: formatInvoiceNumber({
      year: fixtureNumberingYear,
      sequence,
    }),
  };
};

type WorkspaceE2ETransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

const revokeInvoiceRow = Effect.fn("workspaceE2ECustomerInvoice.revokeRow")(
  function* (tx: WorkspaceE2ETransactionClient, invoiceId: string) {
    yield* tx.execute(
      sql`alter table ${invoices} disable trigger invoices_immutable`
    );
    yield* tx.delete(invoices).where(eq(invoices.id, invoiceId));
    yield* tx.execute(
      sql`alter table ${invoices} enable trigger invoices_immutable`
    );
  }
);

const makeCustomerInvoiceDatabase = (
  db: DatabaseClient
): WorkspaceE2ECustomerInvoiceDatabase => ({
  findInvoice: (invoiceId) =>
    db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, invoiceId)),
  insertInvoice: (row) => db.insert(invoices).values(row),
  // Issued invoices are immutable under the invoices_immutable trigger; the
  // fixture row must opt out exactly like the accounting cleanup path does.
  revokeInvoice: (invoiceId) =>
    db.transaction((tx) => revokeInvoiceRow(tx, invoiceId)),
});

const resolveCustomerInvoiceDatabase = (
  dependencies: WorkspaceE2ECustomerInvoiceFixtureDependencies
): Effect.Effect<WorkspaceE2ECustomerInvoiceDatabase, never, E2EDatabase> =>
  dependencies.database
    ? Effect.succeed(dependencies.database)
    : Effect.map(E2EDatabase, ({ db }) => makeCustomerInvoiceDatabase(db));

const buildFixtureDocument = Effect.fn("buildFixtureCustomerInvoiceDocument")(
  function* (input: {
    readonly customerId: DotyposCustomerId;
    readonly invoiceId: string;
    readonly invoiceNumber: InvoiceNumber;
    readonly issuedAt: Temporal.Instant;
  }) {
    const decoded = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
      invoiceId: input.invoiceId,
      dotyposCustomerId: input.customerId,
      buyer: {
        kind: "person",
        legalName: "Workspace E2E Invoice Fixture",
        address: {
          line1: "Synthetic 1",
          city: "Praha",
          postalCode: "100 00",
          country: "CZ",
        },
      },
      deliveryEmail: "workspace-e2e-invoice@example.test",
      locale: "en-US",
      serviceDate: "2099-01-10",
      payment: { status: "due", date: "2099-02-01" },
      currency: "CZK",
      lines: [{ description: "Synthetic workspace rental", price: "450" }],
      provenance: { source: "admin-ui", actor: "workspace-e2e" },
    });
    const normalized = yield* normalizeManualInvoiceInput(decoded);
    return makeManualInvoiceDocument({
      normalized,
      invoiceNumber: input.invoiceNumber,
      issuedAt: input.issuedAt,
    });
  }
);

export function seedWorkspaceE2ECustomerInvoice(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureTestDependencies
): Effect.Effect<WorkspaceE2ECustomerInvoiceFixture, WorkspaceE2EError>;
export function seedWorkspaceE2ECustomerInvoice(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  dependencies?: WorkspaceE2ECustomerInvoiceFixtureDependencies
): Effect.Effect<
  WorkspaceE2ECustomerInvoiceFixture,
  WorkspaceE2EError,
  E2EDatabase
>;
export function seedWorkspaceE2ECustomerInvoice(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureDependencies = {}
): Effect.Effect<
  WorkspaceE2ECustomerInvoiceFixture,
  WorkspaceE2EError,
  E2EDatabase
> {
  return Effect.gen(function* () {
    const database = yield* resolveCustomerInvoiceDatabase(dependencies);
    const ids = makeFixtureInvoiceIds();
    // 2099-01-15T09:30Z is 2099 at the Europe/Prague numbering year boundary.
    const issuedAt = Temporal.Instant.from("2099-01-15T09:30:00Z");
    const document = yield* buildFixtureDocument({
      customerId: input.customerId,
      invoiceId: ids.invoiceId,
      invoiceNumber: ids.invoiceNumber,
      issuedAt,
    }).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("build account invoice fixture document", {
          cause,
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "build account invoice fixture document",
        })
      )
    );
    const keyId = yield* Schema.decodeEffect(accountingSnapshotKeyIdSchema)(
      input.snapshotKey.id
    ).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError(
          "decode account invoice fixture accounting snapshot key id",
          {
            cause,
            diagnosticCode: "postgres_account_fixture_assertion_failed",
            operation: "decode account invoice fixture key id",
          }
        )
      )
    );

    yield* tryWorkspaceE2ESync("assert account invoice fixture key id", () => {
      if (input.snapshotKey.secret.length < 8) {
        throw new Error(
          "The workspace e2e accounting snapshot key secret is too short to be the preview-branch key"
        );
      }
    });

    yield* runDatabaseOperation(
      "seed account invoice fixture row",
      database.insertInvoice({
        id: ids.invoiceId,
        workspaceReservationId: null,
        paymentAttemptId: null,
        dotyposCustomerId: input.customerId,
        invoiceNumber: ids.invoiceNumber,
        numberingYear: fixtureNumberingYear,
        numberingSequence: Number(
          ids.invoiceNumber.slice(ids.invoiceNumber.lastIndexOf("-") + 1)
        ),
        keyId,
        // The pgp_sym_encrypt call must run server-side, so the encrypted
        // document travels as a SQL fragment exactly like the accounting
        // integration fixtures do.
        encryptedDocument: encryptAccountingSnapshot(
          JSON.stringify(document),
          input.snapshotKey.secret
        ) as never,
        issuedAt,
      })
    );

    const revoke = Effect.fn("workspaceE2ECustomerInvoice.revoke")(
      function* () {
        yield* runDatabaseOperation(
          "revoke account invoice fixture row",
          database.revokeInvoice(ids.invoiceId)
        );
        const remaining = yield* runDatabaseOperation(
          "verify account invoice fixture revocation",
          database.findInvoice(ids.invoiceId)
        );
        if (remaining.length > 0) {
          return yield* workspaceE2EError(
            "Account invoice fixture revocation did not converge",
            {
              diagnosticCode: "postgres_account_fixture_convergence_failed",
              operation: "verify account invoice fixture revocation",
            }
          );
        }
      }
    );

    return {
      document,
      invoiceId: ids.invoiceId,
      invoiceNumber: ids.invoiceNumber,
      pdfPath: `/en-US/account/invoices/${ids.invoiceId}/pdf`,
      revoke,
    };
  });
}

export function cleanupWorkspaceE2ECustomerInvoice(
  fixture: WorkspaceE2ECustomerInvoiceFixture,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureTestDependencies
): Effect.Effect<void, WorkspaceE2EError>;
export function cleanupWorkspaceE2ECustomerInvoice(
  fixture: WorkspaceE2ECustomerInvoiceFixture,
  dependencies?: WorkspaceE2ECustomerInvoiceFixtureDependencies
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
export function cleanupWorkspaceE2ECustomerInvoice(
  fixture: WorkspaceE2ECustomerInvoiceFixture,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureDependencies = {}
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> {
  return Effect.gen(function* () {
    const database = yield* resolveCustomerInvoiceDatabase(dependencies);
    yield* runDatabaseOperation(
      "delete account invoice fixture row",
      database.revokeInvoice(fixture.invoiceId)
    );

    const remaining = yield* runDatabaseOperation(
      "verify account invoice fixture cleanup",
      database.findInvoice(fixture.invoiceId)
    );
    if (remaining.length > 0) {
      return yield* workspaceE2EError(
        "Account invoice fixture cleanup did not converge",
        {
          diagnosticCode: "postgres_account_fixture_convergence_failed",
          operation: "verify account invoice fixture cleanup",
        }
      );
    }
  });
}

export function withWorkspaceE2ECustomerInvoiceFixture<A, E, R>(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  use: (fixture: WorkspaceE2ECustomerInvoiceFixture) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureTestDependencies
): Effect.Effect<A, E | WorkspaceE2EError, R>;
export function withWorkspaceE2ECustomerInvoiceFixture<A, E, R>(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  use: (fixture: WorkspaceE2ECustomerInvoiceFixture) => Effect.Effect<A, E, R>,
  dependencies?: WorkspaceE2ECustomerInvoiceFixtureDependencies
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R>;
export function withWorkspaceE2ECustomerInvoiceFixture<A, E, R>(
  input: WorkspaceE2ECustomerInvoiceFixtureInput,
  use: (fixture: WorkspaceE2ECustomerInvoiceFixture) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2ECustomerInvoiceFixtureDependencies = {}
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R> {
  return Effect.acquireUseRelease(
    seedWorkspaceE2ECustomerInvoice(input, dependencies),
    use,
    (fixture) => cleanupWorkspaceE2ECustomerInvoice(fixture, dependencies)
  );
}

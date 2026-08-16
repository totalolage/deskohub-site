import { describe, expect, test } from "bun:test";
import {
  AdministrationDiscountCodeId,
  AdministrationVoucherId,
  AdministrationWorkspaceReservationId,
  CliAccessToken,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

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
const session = {
  id: sessionId,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
};

describe("dhw mutation commands", () => {
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
          providerCredentialRemoved: true,
          sendCancellationEmail: true,
        },
      },
    ]);
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

  test("dispatches the confirmed reservation access mutations", async () => {
    const { accessMutations, layer } = makeCommandLayer();

    await runCommand(
      ["--json", "reservations", "retry-access", "reservation-1", "--yes"],
      layer
    ).pipe(Effect.runPromise);
    await runCommand(
      [
        "--json",
        "reservations",
        "reconcile-access",
        "reservation-1",
        "--provider-credential-removed",
        "--yes",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(accessMutations).toEqual([
      ["reservation-1", { kind: "retry-failed" }],
      [
        "reservation-1",
        {
          kind: "confirm-provider-credential-removed",
          providerCredentialRemoved: true,
        },
      ],
    ]);
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

  test("maps a per-customer code limit", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "codes",
        "create",
        "existing",
        "SUMMER10",
        "01980000-0000-7000-8000-000000000002",
        "--max-uses-per-customer",
        "2",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "create-code",
        code: {
          code: "SUMMER10",
          enabled: true,
          maxUses: null,
          maxUsesPerCustomer: 2,
          validFrom: null,
          validUntil: null,
        },
        discount: {
          kind: "existing",
          discountId: "01980000-0000-7000-8000-000000000002",
        },
      },
    ]);
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

  test("maps broad, category, and product goods targets", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Goods sale",
        "--label-cs",
        "Sleva na zbozi",
        "--percentage",
        "10",
        "--product",
        "goods",
        "--product",
        "goods:category:category-1",
        "--product",
        "goods:product:product-1",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Sleva na zbozi", "en-US": "Goods sale" },
          adjustment: { kind: "percentage", basisPoints: 1000 },
          products: [
            { kind: "goods" },
            { kind: "goods", categoryId: "category-1" },
            { kind: "goods", productId: "product-1" },
          ],
        },
      },
    ]);
  });

  test("rejects malformed goods targets before making a request", async () => {
    const { layer, mutations } = makeCommandLayer();

    const error = await runCommand(
      [
        "--json",
        "discounts",
        "create",
        "percentage",
        "--label-en",
        "Goods sale",
        "--label-cs",
        "Sleva na zbozi",
        "--percentage",
        "10",
        "--product",
        "goods:category:",
      ],
      layer
    ).pipe(Effect.flip, Effect.runPromise);

    expect(error).toBeDefined();
    expect(mutations).toHaveLength(0);
  });

  test("creates reusable voucher credit", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "vouchers",
        "create",
        "VOUCHER100",
        "--credit-value",
        "10000",
        "--currency",
        "CZK",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "create-voucher",
        voucher: {
          code: "VOUCHER100",
          credit: { value: 10_000, exponent: 2, currency: "CZK" },
          enabled: true,
          validFrom: null,
          validUntil: null,
        },
      },
    ]);
  });

  test("updates reusable voucher credit and configuration", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      [
        "--json",
        "vouchers",
        "update",
        voucherId,
        "GIFT150",
        "--credit-value",
        "15000",
        "--currency",
        "CZK",
        "--enabled",
        "false",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      {
        kind: "update-voucher",
        voucher: {
          id: voucherId,
          code: "GIFT150",
          credit: { value: 15_000, exponent: 2, currency: "CZK" },
          enabled: false,
          validFrom: null,
          validUntil: null,
        },
      },
    ]);
  });

  test("manages a voucher audience and deletion", async () => {
    const { layer, mutations } = makeCommandLayer();

    await runCommand(
      ["--json", "vouchers", "add-customer", voucherId, "customer-1", "--yes"],
      layer
    ).pipe(Effect.runPromise);
    await runCommand(
      [
        "--json",
        "vouchers",
        "remove-customer",
        voucherId,
        "customer-1",
        "--yes",
      ],
      layer
    ).pipe(Effect.runPromise);
    await runCommand(
      ["--json", "vouchers", "make-unrestricted", voucherId, "--yes"],
      layer
    ).pipe(Effect.runPromise);
    await runCommand(
      ["--json", "vouchers", "delete", voucherId, "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(mutations).toEqual([
      { kind: "add-voucher-customer", voucherId, customerId: "customer-1" },
      { kind: "remove-voucher-customer", voucherId, customerId: "customer-1" },
      { kind: "make-voucher-unrestricted", voucherId },
      { kind: "delete-voucher", id: voucherId },
    ]);
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
  cancelReservation = () =>
    Effect.succeed({ outcome: "already_cancelled", email: "not_requested" }),
  clear = Effect.succeed(true),
  revokeSession = () => Effect.succeed({ changed: false }),
}: {
  readonly cancelReservation?: WorkspaceAdminApiClient["Service"]["cancelReservation"];
  readonly clear?: AuthenticationService["Service"]["clear"];
  readonly revokeSession?: WorkspaceAdminApiClient["Service"]["revokeSession"];
} = {}) => {
  const mutations: unknown[] = [];
  const accessMutations: unknown[] = [];
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    cancelReservation,
    getReservation: () =>
      Effect.succeed({
        accessGrant: { updatedAt: "2026-08-10T10:00:00.000Z" },
      } as never),
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
    revokeSession,
  });
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({ accessToken: Redacted.make(accessToken), session })
    ),
    save: () => Effect.void,
    clear,
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory: "/tmp/dhw-command-test",
    updateChecksDisabled: true,
  });

  return {
    accessMutations,
    mutations,
    layer: Layer.mergeAll(BunServices.layer, api, authentication, config),
  };
};

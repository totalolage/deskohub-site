import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import { Temporal } from "@js-temporal/polyfill";
import { Effect } from "effect";
import {
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  cancelDotyposReservation,
  getDotyposLayer,
} from "../integrations/dotypos";
import { assert, log } from "../runtime";

export type SyntheticCustomerProfile = {
  readonly customerId: DotyposCustomerId;
  readonly email: string;
  readonly firstName: string;
};

const syntheticBilling = {
  addressLine1: "E2E Synthetic Street 1",
  addressLine2: "",
  city: "E2E Town",
  companyId: "",
  companyName: "",
  country: "CZ",
  vatId: "",
  zip: "00000",
} as const;

/**
 * Creates one synthetic Dotypos profile for the exact synthetic recipient.
 * Created profiles are journaled and expired by finalizers, never deleted.
 */
export const createSyntheticCustomerProfile = (
  config: DatasourceConfig,
  profile: {
    readonly email: string;
    readonly firstName: string;
  }
): Effect.Effect<DotyposCustomerId, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const customer = yield* dotypos.createCustomer({
      ...syntheticBilling,
      email: profile.email,
      firstName: profile.firstName,
      lastName: "E2E",
    });
    assert(customer.id, "created synthetic Dotypos profile has no id");
    log("Synthetic Dotypos profile created");
    return customer.id;
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("create synthetic Dotypos profile", cause)
    )
  );

export const expireSyntheticCustomerProfile = (
  config: DatasourceConfig,
  customerId: DotyposCustomerId
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    yield* dotypos.patchCustomer(customerId, {
      expireDate: new Date(Date.now() - 60_000).toISOString(),
    });
    log("Synthetic Dotypos profile expired");
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("expire synthetic Dotypos profile", cause)
    )
  );

export const readSyntheticCustomerProfile = (
  config: DatasourceConfig,
  customerId: DotyposCustomerId
): Effect.Effect<Customer, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getCustomer(customerId);
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read synthetic Dotypos profile", cause)
    )
  );

export const findSyntheticCustomerProfile = (
  config: DatasourceConfig,
  email: string
): Effect.Effect<readonly Customer[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const result = yield* dotypos.findCustomer(
      { email, firstName: "E2E" },
      { lookupFields: ["email"] }
    );
    return "matches" in result ? result.matches : [];
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("find synthetic Dotypos profile", cause)
    )
  );

/**
 * Asserts the provider has no profile for the exact synthetic recipient:
 * the deployed sign-in request must not mutate Dotypos before verification.
 */
export const assertNoSyntheticCustomerProfile = (
  config: DatasourceConfig,
  email: string
): Effect.Effect<void, WorkspaceE2EError> =>
  findSyntheticCustomerProfile(config, email).pipe(
    Effect.flatMap((matches) =>
      matches.length === 0
        ? Effect.void
        : Effect.fail(
            workspaceE2EError(
              "Dotypos holds a profile for the synthetic recipient before verification",
              {
                diagnosticCode: "dotypos_account_fixture_mutation_failed",
                operation: "assert no synthetic Dotypos profile",
              }
            )
          )
    )
  );

const futureReservationDays = 120;

export type SyntheticReservation = {
  readonly endsAt: Temporal.Instant;
  readonly reservationId: DotyposReservationId | undefined;
  readonly startsAt: Temporal.Instant;
};

/**
 * Creates one far-future synthetic reservation outside the checkout
 * candidate range so account cases never contend with parallel checkout
 * availability. The reservation is journaled, cancelled, and converged by
 * finalizers.
 */
export const createSyntheticReservation = (
  config: DatasourceConfig,
  input: { readonly customerId: DotyposCustomerId; readonly seats?: number }
): Effect.Effect<SyntheticReservation, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const tables = yield* dotypos.getTables();
    const table = tables.find(
      (candidate) =>
        candidate.enabled === true &&
        candidate.display === true &&
        !candidate.tags?.includes(workspaceOfficeReservationTableTag) &&
        !candidate.tags?.includes(workspaceMeetingRoomReservationTableTag)
    );
    if (!table?.id) {
      return yield* workspaceE2EError(
        "No enabled shared table is available for the synthetic account reservation",
        {
          diagnosticCode: "dotypos_account_fixture_mutation_failed",
          operation: "select synthetic reservation table",
        }
      );
    }
    const startsAtMillis =
      Date.now() + futureReservationDays * 24 * 60 * 60 * 1000;
    const startsAt = new Date(startsAtMillis);
    const endsAt = new Date(startsAtMillis + 2 * 60 * 60 * 1000);
    const reservation = yield* dotypos.createReservation({
      customerId: input.customerId,
      endDate: endsAt,
      seats: input.seats ?? 1,
      startDate: startsAt,
      status: "CONFIRMED",
      tableId: table.id,
    });
    log("Synthetic Dotypos reservation created");
    return {
      endsAt: Temporal.Instant.fromEpochMilliseconds(endsAt.getTime()),
      reservationId: reservation.id,
      startsAt: Temporal.Instant.fromEpochMilliseconds(startsAt.getTime()),
    };
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("create synthetic Dotypos reservation", cause)
    )
  );

export const cancelSyntheticReservation = (
  config: DatasourceConfig,
  reservationId: DotyposReservationId
): Effect.Effect<void, WorkspaceE2EError> =>
  cancelDotyposReservation(config, reservationId);

export const decodeSyntheticCustomerId = (value: unknown) => {
  assert(typeof value === "string" && value.trim() !== "", "customer id");
  return value as DotyposCustomerId;
};

export const decodeSyntheticReservationId = (value: unknown) => {
  assert(typeof value === "string" && value.trim() !== "", "reservation id");
  return value as DotyposReservationId;
};

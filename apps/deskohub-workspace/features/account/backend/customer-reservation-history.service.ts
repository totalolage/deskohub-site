import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import { desc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type {
  CustomerReservationHistory,
  CustomerReservationProduct,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "../contracts";
import { groupCustomerReservations } from "../contracts";
import type {
  CustomerAccountAccessError,
  LinkedCustomerAccount,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

type CustomerReservationHistoryError =
  | EffectDrizzleQueryError
  | SqlError
  | ExternalAPIError
  | NetworkError
  | ValidationError;

type ReservationRow = {
  readonly id: (typeof workspaceReservations.$inferSelect)["id"];
  readonly dotyposReservationId: DotyposReservationId | null;
  readonly reservationDetails: (typeof workspaceReservations.$inferSelect)["reservationDetails"];
  readonly reservationState: (typeof workspaceReservations.$inferSelect)["reservationState"];
  readonly fulfillmentState: (typeof workspaceReservations.$inferSelect)["fulfillmentState"];
};

const getReservationProduct = (
  row: ReservationRow | undefined
): CustomerReservationProduct => {
  const details = row?.reservationDetails;
  if (!details) return { kind: "other" };
  switch (details.kind) {
    case "cowork":
      return { kind: "cowork", tier: details.entryTier };
    case "meeting-room":
      return { kind: "meeting-room" };
    case "office":
      return { kind: "office" };
  }
};

const getReservationStatus = (
  reservation: DotyposReservation,
  row: ReservationRow | undefined
): CustomerReservationStatus => {
  if (
    reservation.status === "CANCELLED" ||
    row?.reservationState === "cancelled" ||
    row?.reservationState === "hold_expired"
  ) {
    return "cancelled";
  }
  if (
    row?.reservationState === "cancellation_failed" ||
    row?.fulfillmentState === "failed"
  ) {
    return "requires-attention";
  }
  return reservation.status === "CONFIRMED" ? "confirmed" : "pending";
};

const toReservationSummary = (
  reservation: DotyposReservation,
  row: ReservationRow | undefined,
  index: number
): CustomerReservationSummary => ({
  id: row?.id ?? reservation.id ?? `${reservation.startDate}:${index}`,
  product: getReservationProduct(row),
  startsAt: reservation.startDate,
  endsAt: reservation.endDate,
  seats: /^\d+$/.test(reservation.seats) ? Number(reservation.seats) : null,
  status: getReservationStatus(reservation, row),
});

interface ICustomerReservationHistoryService {
  readonly load: (
    account: LinkedCustomerAccount
  ) => Effect.Effect<
    CustomerReservationHistory,
    CustomerAccountAccessError | CustomerReservationHistoryError
  >;
}

export class CustomerReservationHistoryService extends Context.Service<
  CustomerReservationHistoryService,
  ICustomerReservationHistoryService
>()("@deskohub-workspace/account/CustomerReservationHistoryService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const links = yield* CustomerAccountLinkRepository;

      const load = Effect.fn("CustomerReservationHistoryService.load")(
        function* (account: LinkedCustomerAccount) {
          yield* requireAccountActivity(links, account.accountId);

          const rows = yield* db
            .select({
              id: workspaceReservations.id,
              dotyposReservationId: workspaceReservations.dotyposReservationId,
              reservationDetails: workspaceReservations.reservationDetails,
              reservationState: workspaceReservations.reservationState,
              fulfillmentState: workspaceReservations.fulfillmentState,
            })
            .from(workspaceReservations)
            .where(
              eq(
                workspaceReservations.dotyposCustomerId,
                account.dotyposCustomerId
              )
            )
            .orderBy(desc(workspaceReservations.createdAt));
          const reservations = yield* dotypos.listReservations({
            customerId: account.dotyposCustomerId,
            order: "startDateDescending",
          });
          const rowsByReservationId = new Map(
            rows.flatMap((row) =>
              row.dotyposReservationId
                ? [[row.dotyposReservationId, row] as const]
                : []
            )
          );
          const summaries = reservations.map((reservation, index) =>
            toReservationSummary(
              reservation,
              reservation.id
                ? rowsByReservationId.get(reservation.id)
                : undefined,
              index
            )
          );
          return {
            kind: "available",
            groups: groupCustomerReservations(summaries),
          } as const;
        }
      );

      return { load } satisfies ICustomerReservationHistoryService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        CustomerAccountLinkRepository.Live
      )
    )
  );
}

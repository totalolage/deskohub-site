import type {
  DotyposCustomerId,
  DotyposReservation,
  DotyposReservationId,
  ExternalAPIError,
  NetworkError,
} from "@deskohub/dotypos";
import { DotyposService } from "@deskohub/dotypos";
import { desc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import { customerAccountLinks, workspaceReservations } from "@/db/schema";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import type {
  CustomerAccountId,
  CustomerReservationGroups,
  CustomerReservationHistory,
  CustomerReservationProduct,
  CustomerReservationStatus,
  CustomerReservationSummary,
} from "../contracts";

export type CustomerAccountIdentity = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  readonly name: string;
};

export type CustomerLinkResolution =
  | { readonly kind: "linked"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" };

type ReservationRow = {
  readonly id: (typeof workspaceReservations.$inferSelect)["id"];
  readonly dotyposReservationId: DotyposReservationId | null;
  readonly reservationDetails: (typeof workspaceReservations.$inferSelect)["reservationDetails"];
  readonly reservationState: (typeof workspaceReservations.$inferSelect)["reservationState"];
  readonly paymentState: (typeof workspaceReservations.$inferSelect)["paymentState"];
  readonly fulfillmentState: (typeof workspaceReservations.$inferSelect)["fulfillmentState"];
};

interface ICustomerAccountService {
  readonly resolveCustomerLink: (
    identity: CustomerAccountIdentity
  ) => Effect.Effect<
    CustomerLinkResolution,
    EffectDrizzleQueryError | ExternalAPIError | NetworkError
  >;
  readonly loadReservationHistory: (
    identity: CustomerAccountIdentity
  ) => Effect.Effect<CustomerReservationHistory, EffectDrizzleQueryError>;
  readonly unlink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

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

export const groupCustomerReservations = (
  reservations: readonly CustomerReservationSummary[],
  now: Temporal.Instant = Temporal.Now.instant()
): CustomerReservationGroups => {
  const current: CustomerReservationSummary[] = [];
  const past: CustomerReservationSummary[] = [];
  const unavailable: CustomerReservationSummary[] = [];

  for (const reservation of reservations) {
    if (!reservation.endsAt) {
      unavailable.push(reservation);
      continue;
    }

    const ended =
      Temporal.Instant.compare(
        Temporal.Instant.from(reservation.endsAt),
        now
      ) <= 0;
    if (ended || reservation.status === "cancelled") {
      past.push(reservation);
    } else {
      current.push(reservation);
    }
  }

  return { current, past, unavailable };
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

export class CustomerAccountService extends Context.Service<
  CustomerAccountService,
  ICustomerAccountService
>()("@deskohub-workspace/account/CustomerAccountService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;

      const findLink = Effect.fn("CustomerAccountService.findLink")(function* (
        accountId: CustomerAccountId
      ) {
        const [link] = yield* db
          .select({ customerId: customerAccountLinks.dotyposCustomerId })
          .from(customerAccountLinks)
          .where(eq(customerAccountLinks.customerAccountId, accountId))
          .limit(1);
        return link?.customerId ?? null;
      });

      const resolveCustomerLink = Effect.fn(
        "CustomerAccountService.resolveCustomerLink"
      )(function* (identity: CustomerAccountIdentity) {
        const existingCustomerId = yield* findLink(identity.accountId);
        if (existingCustomerId) {
          return {
            kind: "linked",
            customerId: existingCustomerId,
          } as const satisfies CustomerLinkResolution;
        }

        const match = yield* dotypos.findCustomer(
          { firstName: identity.name, email: identity.email },
          { lookupFields: ["email"] }
        );
        if (match._tag === "NotFound") {
          return {
            kind: "not-found",
          } as const satisfies CustomerLinkResolution;
        }
        if (match._tag === "Ambiguous" || !match.customer.id) {
          return {
            kind: "ambiguous",
          } as const satisfies CustomerLinkResolution;
        }

        const inserted = yield* db
          .insert(customerAccountLinks)
          .values({
            customerAccountId: identity.accountId,
            dotyposCustomerId: match.customer.id,
          })
          .onConflictDoNothing()
          .returning({ customerId: customerAccountLinks.dotyposCustomerId });
        if (inserted[0]) {
          return {
            kind: "linked",
            customerId: inserted[0].customerId,
          } as const satisfies CustomerLinkResolution;
        }

        const racedCustomerId = yield* findLink(identity.accountId);
        return racedCustomerId
          ? ({
              kind: "linked",
              customerId: racedCustomerId,
            } as const satisfies CustomerLinkResolution)
          : ({ kind: "ambiguous" } as const satisfies CustomerLinkResolution);
      });

      const loadReservationRows = Effect.fn(
        "CustomerAccountService.loadReservationRows"
      )(function* (customerId: DotyposCustomerId) {
        return yield* db
          .select({
            id: workspaceReservations.id,
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationDetails: workspaceReservations.reservationDetails,
            reservationState: workspaceReservations.reservationState,
            paymentState: workspaceReservations.paymentState,
            fulfillmentState: workspaceReservations.fulfillmentState,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.dotyposCustomerId, customerId))
          .orderBy(desc(workspaceReservations.createdAt));
      });

      const loadReservationHistory = Effect.fn(
        "CustomerAccountService.loadReservationHistory"
      )(function* (identity: CustomerAccountIdentity) {
        const linkResult = yield* resolveCustomerLink(identity).pipe(
          Effect.option
        );
        if (linkResult._tag === "None") {
          return {
            kind: "unavailable",
            reason: "provider-unavailable",
          } as const;
        }
        const link = linkResult.value;
        if (link.kind === "not-found") {
          return {
            kind: "available",
            groups: { current: [], past: [], unavailable: [] },
          } as const;
        }
        if (link.kind === "ambiguous") {
          return {
            kind: "unavailable",
            reason: "ambiguous-customer",
          } as const;
        }

        const rows = yield* loadReservationRows(link.customerId);
        const reservations = yield* dotypos
          .listReservations({
            customerId: link.customerId,
            order: "startDateDescending",
          })
          .pipe(Effect.option);
        if (reservations._tag === "None") {
          return {
            kind: "unavailable",
            reason: "provider-unavailable",
          } as const;
        }

        const rowsByReservationId = new Map(
          rows.flatMap((row) =>
            row.dotyposReservationId
              ? [[row.dotyposReservationId, row] as const]
              : []
          )
        );
        const summaries = reservations.value.map((reservation, index) =>
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
      });

      const unlink = Effect.fn("CustomerAccountService.unlink")(
        (accountId: CustomerAccountId) =>
          db
            .delete(customerAccountLinks)
            .where(eq(customerAccountLinks.customerAccountId, accountId))
            .pipe(Effect.asVoid)
      );

      return {
        resolveCustomerLink,
        loadReservationHistory,
        unlink,
      } satisfies ICustomerAccountService;
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive)
  );
}

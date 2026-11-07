import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { Locale } from "@/features/i18n";
import {
  ReservationAuthorizationService,
  type ReservationAuthorizationUnavailableError,
} from "@/features/reservation/backend/reservation-authorization.service";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { InvoiceRepository } from "./invoice.repository";
import {
  type InvoicePdfFile,
  type InvoicePdfRenderingError,
  renderInvoicePdfFile,
} from "./invoice-pdf";
import type { InvoiceStorageError } from "./invoice-reads";

/**
 * The reservation doesn't exist, or the visitor may not see its invoice. The
 * two stay indistinguishable, so the answer never reveals a reservation.
 */
export class ReservationInvoiceNotFoundError extends Data.TaggedError(
  "ReservationInvoiceNotFoundError"
)<{
  readonly orderId: WorkspaceReservationId;
}> {}

/**
 * The visitor may see the reservation's invoice, but none has been issued:
 * the reservation isn't paid and fulfilled yet, or it needs no invoice.
 */
export class ReservationInvoiceNotIssuedError extends Data.TaggedError(
  "ReservationInvoiceNotIssuedError"
)<{
  readonly orderId: WorkspaceReservationId;
}> {}

/**
 * Identifies the reservation and how the visitor proves access: the signed-in
 * account from Context, or an emailed capability link or access cookie.
 */
interface ReservationInvoicePdfRequest {
  readonly orderId: WorkspaceReservationId;
  /** The locale an emailed capability link was issued for. */
  readonly locale: Locale;
  readonly accessCookie?: string;
  readonly accessToken?: ReservationAccessToken;
}

type ReservationInvoicePdfError =
  | ReservationInvoiceNotFoundError
  | ReservationInvoiceNotIssuedError
  | ReservationAuthorizationUnavailableError
  | EffectDrizzleQueryError
  | InvoiceStorageError
  | InvoicePdfRenderingError
  | WorkspaceReservationDetailsMalformedError;

export interface IReservationInvoicePdfService {
  /**
   * Renders the reservation's issued invoice from its stored document, for a
   * visitor allowed to see it. An issued invoice stays available whatever
   * later happens to the reservation.
   */
  readonly getPdf: (
    request: ReservationInvoicePdfRequest
  ) => Effect.Effect<InvoicePdfFile, ReservationInvoicePdfError>;
}

export class ReservationInvoicePdfService extends Context.Service<
  ReservationInvoicePdfService,
  IReservationInvoicePdfService
>()("@deskohub-workspace/accounting/ReservationInvoicePdfService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authorization = yield* ReservationAuthorizationService;
      const invoices = yield* InvoiceRepository;
      const reservations = yield* WorkspaceReservationRepository;

      const getPdf = Effect.fn("ReservationInvoicePdfService.getPdf")(
        function* (request: ReservationInvoicePdfRequest) {
          const authorized = yield* authorization.authorize({
            ...request,
            permission: "view-invoice",
          });
          if (!authorized) {
            return yield* new ReservationInvoiceNotFoundError({
              orderId: request.orderId,
            });
          }

          const invoice = yield* invoices.findByReservationId(request.orderId);
          if (!invoice) {
            // A valid capability doesn't read the reservation, so it may still
            // name one that no longer exists.
            const reservation = yield* reservations.findById(request.orderId);
            return yield* reservation
              ? new ReservationInvoiceNotIssuedError({
                  orderId: request.orderId,
                })
              : new ReservationInvoiceNotFoundError({
                  orderId: request.orderId,
                });
          }

          return yield* renderInvoicePdfFile(invoice.document);
        }
      );

      return { getPdf } satisfies IReservationInvoicePdfService;
    })
  );

  /**
   * The service deciding who may see an invoice through `authorization`,
   * such as one reading the customer API's session.
   */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          authorization,
          InvoiceRepository.Live,
          WorkspaceReservationRepository.Live
        )
      )
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}

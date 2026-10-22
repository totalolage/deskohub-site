import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer, Result } from "effect";
import { CustomerAccountReservationOwnership } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { ReviewSandbox } from "@/features/review-accounts";
import {
  openReservationAccessCookie,
  type ReservationAccessCookieOptions,
} from "./reservation-access-cookie";
import { openReservationAccessToken } from "./reservation-access-token";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

/** What a visitor may see of a reservation. */
type ReservationPermission = "view-status" | "view-access-code";

/**
 * Who may see what. The customer's emailed capability links, the access
 * cookie, and the account linked to the reservation's customer see
 * everything. The author's session sees the status only, so the door access
 * code stays with the customer the reservation was booked for.
 */
const reservationAccessPolicy = {
  capability: ["view-status", "view-access-code"],
  customer: ["view-status", "view-access-code"],
  author: ["view-status"],
} as const satisfies Record<string, readonly ReservationPermission[]>;

const grants = (
  grant: keyof typeof reservationAccessPolicy,
  permission: ReservationPermission
) =>
  (reservationAccessPolicy[grant] as readonly ReservationPermission[]).includes(
    permission
  );

export type ReservationAuthorizationInput = {
  readonly accessCookie?: string;
  readonly accessToken?: ReservationAccessToken;
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
  readonly permission: ReservationPermission;
};

export interface IReservationAuthorizationService {
  readonly isAuthorized: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean>;
}

const capabilityIsValid = Effect.fn(
  "ReservationAuthorizationService.capabilityIsValid"
)(function* (
  input: ReservationAuthorizationInput,
  options: ReservationAccessCookieOptions = {}
) {
  if (input.accessCookie) {
    const cookie = yield* openReservationAccessCookie(
      { value: input.accessCookie, orderId: input.orderId },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(cookie)) return true;
  }

  if (input.accessToken) {
    const token = yield* openReservationAccessToken(
      {
        token: input.accessToken,
        orderId: input.orderId,
        locale: input.locale,
      },
      options
    ).pipe(Effect.result);
    if (Result.isSuccess(token)) return true;
  }

  return false;
});

export class ReservationAuthorizationService extends Context.Service<
  ReservationAuthorizationService,
  IReservationAuthorizationService
>()("@deskohub-workspace/reservation/ReservationAuthorizationService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const ownership = yield* CustomerAccountReservationOwnership;
      const reservations = yield* WorkspaceReservationRepository;
      const reviewSandbox = yield* ReviewSandbox;

      const isReviewSandboxOrderOf = (
        accountId: CustomerAccountId,
        orderId: WorkspaceReservationId
      ) =>
        reviewSandbox
          .isOrderOf({ accountId, orderId })
          .pipe(Effect.orElseSucceed(() => false));

      const isAuthorized = Effect.fn(
        "ReservationAuthorizationService.isAuthorized"
      )(function* (input: ReservationAuthorizationInput) {
        if (
          grants("capability", input.permission) &&
          (yield* capabilityIsValid(input))
        ) {
          return true;
        }

        // Both account grants need an active signed-in account; only the
        // customer grant also needs the account's linked Dotypos customer.
        const accountId = yield* ownership.activeAccountId.pipe(Effect.result);
        if (Result.isFailure(accountId)) return false;

        const reservation = yield* reservations
          .findById(input.orderId)
          .pipe(Effect.result);
        if (Result.isFailure(reservation)) return false;
        // A review account's sandbox order is the account's own booking, so
        // it sees what an author sees: the status, never an access code.
        if (!reservation.success) {
          return (
            grants("author", input.permission) &&
            (yield* isReviewSandboxOrderOf(accountId.success, input.orderId))
          );
        }

        if (
          grants("author", input.permission) &&
          reservation.success.authorAccountId === accountId.success
        ) {
          return true;
        }
        if (!grants("customer", input.permission)) return false;

        const account = yield* ownership.resolve.pipe(Effect.result);
        return (
          Result.isSuccess(account) &&
          account.success.dotyposCustomerId ===
            (reservation.success.dotyposCustomerId as DotyposCustomerId)
        );
      });

      return { isAuthorized } satisfies IReservationAuthorizationService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountReservationOwnership.Live,
        WorkspaceReservationRepository.Live,
        ReviewSandbox.Live
      )
    )
  );
}

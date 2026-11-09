import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Option, Result } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  type CustomerAccountAccessError,
  CustomerAccountReservationOwnership,
} from "@/features/account";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
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
import type { WorkspaceReservationDetailsMalformedError } from "./stored-reservation-details.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

/** What a visitor may see of a reservation. */
type ReservationPermission =
  | "view-status"
  | "view-access-code"
  | "view-invoice";

/**
 * Who may see what. The customer's emailed capability links, the access
 * cookie, and the account linked to the reservation's customer see
 * everything. The author's session sees the status only, so the door access
 * code and the invoice stay with the customer the reservation was booked for.
 */
const reservationAccessPolicy = {
  capability: ["view-status", "view-access-code", "view-invoice"],
  customer: ["view-status", "view-access-code", "view-invoice"],
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

/**
 * The signed-in account, its customer link, the reservation, or the review
 * sandbox couldn't be read, so whether the visitor may see the reservation
 * is unknown.
 */
export class ReservationAuthorizationUnavailableError extends Data.TaggedError(
  "ReservationAuthorizationUnavailableError"
)<{
  readonly orderId: WorkspaceReservationId;
  readonly cause:
    | CustomerAccountAccessError
    | EffectDrizzleQueryError
    | SqlError.SqlError
    | WorkspaceReservationDetailsMalformedError;
}> {}

export interface IReservationAuthorizationService {
  /** Denies the visitor whenever a read fails. */
  readonly isAuthorized: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean>;
  /**
   * Decides like `isAuthorized`, but reports a failed account, customer link,
   * reservation, or review sandbox read instead of denying. A signed-out or
   * unlinked visitor is still denied.
   */
  readonly authorize: (
    input: ReservationAuthorizationInput
  ) => Effect.Effect<boolean, ReservationAuthorizationUnavailableError>;
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

/**
 * The visitor's account, or `None` for a signed-out, unverified, or unlinked
 * visitor. A failed read stays a failure.
 */
const unlessDenied = <A>(
  account: Effect.Effect<A, CustomerAccountAccessError>
) =>
  account.pipe(
    Effect.asSome,
    Effect.catchIf(
      (error) => error.reason !== "unavailable",
      () => Effect.succeedNone
    )
  );

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

      /**
       * The active account sees the reservation as its author, or as the
       * signed-in account linked to the reservation's customer.
       */
      const isAuthorOrCustomerOf = Effect.fnUntraced(function* (
        accountId: CustomerAccountId,
        reservation: WorkspaceReservation,
        permission: ReservationPermission
      ) {
        if (
          grants("author", permission) &&
          reservation.authorAccountId === accountId
        ) {
          return true;
        }
        if (!grants("customer", permission)) return false;

        const account = yield* unlessDenied(ownership.resolve);
        return (
          Option.isSome(account) &&
          account.value.dotyposCustomerId ===
            (reservation.dotyposCustomerId as DotyposCustomerId)
        );
      });

      const decide = Effect.fnUntraced(function* (
        input: ReservationAuthorizationInput
      ) {
        if (
          grants("capability", input.permission) &&
          (yield* capabilityIsValid(input))
        ) {
          return true;
        }

        // Both account grants need an active signed-in account; only the
        // customer grant also needs the account's linked Dotypos customer.
        const accountId = yield* unlessDenied(ownership.activeAccountId);
        if (Option.isNone(accountId)) return false;

        const reservation = yield* reservations.findById(input.orderId);
        // A review account's sandbox order is the account's own booking, so
        // it sees what an author sees: the status, never an access code.
        if (!reservation) {
          return (
            grants("author", input.permission) &&
            (yield* reviewSandbox.isOrderOf({
              accountId: accountId.value,
              orderId: input.orderId,
            }))
          );
        }

        return yield* isAuthorOrCustomerOf(
          accountId.value,
          reservation,
          input.permission
        );
      });

      const authorize = Effect.fn("ReservationAuthorizationService.authorize")(
        (input: ReservationAuthorizationInput) =>
          decide(input).pipe(
            Effect.mapError(
              (cause) =>
                new ReservationAuthorizationUnavailableError({
                  orderId: input.orderId,
                  cause,
                })
            )
          )
      );

      const isAuthorized = Effect.fn(
        "ReservationAuthorizationService.isAuthorized"
      )((input: ReservationAuthorizationInput) =>
        decide(input).pipe(Effect.orElseSucceed(() => false))
      );

      return {
        isAuthorized,
        authorize,
      } satisfies IReservationAuthorizationService;
    })
  );

  /**
   * The service deciding for the account `authentication` reads, such as
   * the customer API's session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CustomerAccountReservationOwnership.withAuthentication(
            authentication
          ),
          WorkspaceReservationRepository.Live,
          ReviewSandbox.Live
        )
      )
    );

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}

import {
  AdministrationCustomerActivity,
  AdministrationCustomerProfile,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Match, Option, Schema } from "effect";
import { AdministrationService } from "@/features/administration/administration.service";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import {
  type AdminCustomerProfile,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export class CustomerValueUnauthorized extends Data.TaggedError(
  "CustomerValueUnauthorized"
) {}

export class CustomerValueMissing extends Data.TaggedError(
  "CustomerValueMissing"
)<{ readonly reason: "customer-not-found" | "field-absent" }> {}

// Source failures can contain customer payloads. Keep only the outcome at this boundary.
export class CustomerValueUnavailable extends Data.TaggedError(
  "CustomerValueUnavailable"
)<{ readonly source: "authorization" | "profile" | "activity" }> {}

export class CustomerValueRejected extends Data.TaggedError(
  "CustomerValueRejected"
)<{
  readonly reason:
    | "source-rejected"
    | "invalid-data"
    | "incompatible-shape"
    | "incompatible-sort";
}> {}

type CustomerValueSourceFailure =
  | CustomerValueUnauthorized
  | CustomerValueMissing
  | CustomerValueUnavailable
  | CustomerValueRejected;

interface ICustomerValueSource {
  readonly profile: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdministrationCustomerProfile,
    CustomerValueSourceFailure
  >;
  /** History is the administration's bounded window; its truncation flags remain in the result. */
  readonly activity: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    AdministrationCustomerActivity,
    CustomerValueSourceFailure
  >;
}

/** The profile and activity loaders, each run after `authorize` admits the read. */
const customerValueLoaders = Effect.fn("CustomerValueSource.loaders")(
  function* (
    authorize: Effect.Effect<
      void,
      CustomerValueUnauthorized | CustomerValueUnavailable
    >
  ) {
    const discounts = yield* DiscountAdministration;
    const administration = yield* AdministrationService;
    return {
      profile: Effect.fn("CustomerValueSource.profile")(
        (input: { readonly customerId: DotyposCustomerId }) =>
          authorize.pipe(
            Effect.andThen(() =>
              discounts.loadCustomerProfile(input).pipe(
                Effect.mapError((error) =>
                  Match.value(error).pipe(
                    Match.tagsExhaustive({
                      DiscountAdminNotFoundError: () =>
                        new CustomerValueMissing({
                          reason: "customer-not-found",
                        }),
                      DotyposRejected: () =>
                        new CustomerValueRejected({
                          reason: "source-rejected",
                        }),
                      DotyposUnavailable: () =>
                        new CustomerValueUnavailable({ source: "profile" }),
                      EffectDrizzleQueryError: () =>
                        new CustomerValueUnavailable({ source: "profile" }),
                      SqlError: () =>
                        new CustomerValueUnavailable({ source: "profile" }),
                    })
                  )
                )
              )
            ),
            Effect.map(customerProfileWireInput),
            Effect.flatMap((profile) =>
              Schema.decodeUnknownEffect(AdministrationCustomerProfile)(
                profile
              ).pipe(
                Effect.mapError(
                  () => new CustomerValueRejected({ reason: "invalid-data" })
                )
              )
            )
          )
      ),
      activity: Effect.fn("CustomerValueSource.activity")(
        ({ customerId }: { readonly customerId: DotyposCustomerId }) =>
          authorize.pipe(
            Effect.andThen(() =>
              administration.loadCustomerActivityStrict(customerId).pipe(
                Effect.mapError((error) =>
                  Match.value(error).pipe(
                    Match.tagsExhaustive({
                      WorkspaceReservationDetailsMalformedError: () =>
                        new CustomerValueRejected({ reason: "invalid-data" }),
                      AdministrationListSourceUnavailableError: () =>
                        new CustomerValueUnavailable({ source: "activity" }),
                      EffectDrizzleQueryError: () =>
                        new CustomerValueUnavailable({ source: "activity" }),
                    })
                  )
                )
              )
            ),
            Effect.flatMap((activity) =>
              Schema.decodeUnknownEffect(AdministrationCustomerActivity)(
                activity
              ).pipe(
                Effect.mapError(
                  () => new CustomerValueRejected({ reason: "invalid-data" })
                )
              )
            )
          )
      ),
    } satisfies ICustomerValueSource;
  }
);

export class CustomerValueSource extends Context.Service<
  CustomerValueSource,
  ICustomerValueSource
>()("@deskohub-workspace/emails/CustomerValueSource") {
  /** Reads for an administrator; every read rechecks the current administrator's grant. */
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const grants = yield* AccountRoleGrants;
      return yield* customerValueLoaders(
        Effect.serviceOption(CurrentAdministrator).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new CustomerValueUnauthorized()),
              onSome: (actor) =>
                grants
                  .has({ accountId: actor.accountId, role: "administrator" })
                  .pipe(
                    Effect.mapError(
                      () =>
                        new CustomerValueUnavailable({
                          source: "authorization",
                        })
                    ),
                    Effect.filterOrFail(
                      Boolean,
                      () => new CustomerValueUnauthorized()
                    )
                  ),
            })
          )
        )
      );
    })
  );

  /**
   * Reads for server-side recipient preparation of a delivery an administrator
   * already authorized. It has no request actor, so never provide it to a
   * route, action, or other request handler.
   */
  static Delivery = Layer.effect(this, customerValueLoaders(Effect.void));

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        AccountRoleGrants.Live,
        DiscountAdministration.Live,
        AdministrationService.Live
      )
    )
  );
}

// Match the administration wire boundary, then let its schema discard internal-only fields.
const customerProfileWireInput = (profile: AdminCustomerProfile) => ({
  ...profile,
  codes: profile.codes.map((code) => ({
    ...code,
    validFrom: code.validFrom?.toString() ?? null,
    validUntil: code.validUntil?.toString() ?? null,
    createdAt: code.createdAt.toString(),
    updatedAt: code.updatedAt.toString(),
  })),
  claims: profile.claims.map((claim) => ({
    ...claim,
    reservationExpiresAt: claim.reservationExpiresAt.toString(),
    reservedAt: claim.reservedAt.toString(),
    redeemedAt: claim.redeemedAt?.toString() ?? null,
    releasedAt: claim.releasedAt?.toString() ?? null,
  })),
  vouchers: profile.vouchers.map((voucher) => ({
    ...voucher,
    validFrom: voucher.validFrom?.toString() ?? null,
    validUntil: voucher.validUntil?.toString() ?? null,
    createdAt: voucher.createdAt.toString(),
    updatedAt: voucher.updatedAt.toString(),
  })),
  voucherClaims: profile.voucherClaims.map((claim) => ({
    ...claim,
    reservationExpiresAt: claim.reservationExpiresAt.toString(),
    reservedAt: claim.reservedAt.toString(),
    redeemedAt: claim.redeemedAt?.toString() ?? null,
    releasedAt: claim.releasedAt?.toString() ?? null,
  })),
});

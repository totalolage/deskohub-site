import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Schema } from "effect";
import {
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAuthentication } from "./customer-authentication.service";
import { CustomerProfileService } from "./customer-profile.service";

/**
 * The reservation contact a signed-in, already-linked customer books with.
 * The email is the immutable login email; the name and phone come from the
 * linked Dotypos profile and are only exposed when they satisfy the
 * reservation contact rules.
 */
export type CustomerAccountContact = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
};

const decodeContactField = <S extends Schema.Decoder<string>>(
  schema: S,
  value: string
) => Option.getOrNull(Schema.decodeUnknownOption(schema)(value));

interface ICustomerAccountContactService {
  /**
   * Reads the current account's reservation contact without claiming a
   * link, so it is safe both on read-only pages and inside the account
   * activity guard. Anonymous, deletion-pending, and unlinked sessions, and
   * profiles whose name cannot book a reservation, yield null.
   */
  readonly current: Effect.Effect<
    CustomerAccountContact | null,
    CustomerAccountAccessError
  >;
}

export class CustomerAccountContactService extends Context.Service<
  CustomerAccountContactService,
  ICustomerAccountContactService
>()("@deskohub-workspace/account/CustomerAccountContactService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const links = yield* CustomerAccountLinkRepository;
      const profiles = yield* CustomerProfileService;

      const current = Effect.gen(function* () {
        const session = yield* authentication.currentUser;
        if (!session || session.deletionRequested) return null;

        const dotyposCustomerId = yield* links
          .find(session.accountId)
          .pipe(
            Effect.mapError(mapCustomerAccountFailure("account-link.read"))
          );
        if (!dotyposCustomerId) return null;

        const profile = yield* profiles.load({
          accountId: session.accountId,
          dotyposCustomerId,
        });
        const name = decodeContactField(
          reservationCustomerNameSchema,
          [profile.firstName, profile.lastName]
            .map((part) => part?.trim())
            .filter(Boolean)
            .join(" ")
        );
        if (!name) return null;

        return {
          accountId: session.accountId,
          dotyposCustomerId,
          name,
          email: session.email,
          phone: profile.phone
            ? decodeContactField(reservationCustomerPhoneSchema, profile.phone)
            : null,
        } satisfies CustomerAccountContact;
      }).pipe(Effect.withSpan("CustomerAccountContactService.current"));

      return { current } satisfies ICustomerAccountContactService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAuthentication.Default,
        CustomerAccountLinkRepository.Live,
        CustomerProfileService.Live
      )
    )
  );
}

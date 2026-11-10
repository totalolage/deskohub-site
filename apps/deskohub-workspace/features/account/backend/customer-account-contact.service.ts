import type { DotyposCustomerId } from "@deskohub/dotypos";
import { formatPhoneNumber, parsePhoneNumber } from "@deskohub/phone-number";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { baseLocale, defaultPhoneRegion } from "@/features/i18n";
import {
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import { getReviewAccountContact } from "@/features/review-accounts";
import type { CustomerProfile, CustomerProfileSave } from "../contracts";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { CustomerProfileService } from "./customer-profile.service";

/**
 * A signed-in account's durable Dotypos link with its login email, before
 * the profile is read.
 */
export type CurrentLinkedAccount = LinkedCustomerAccount & {
  readonly email: CustomerAccountSession["email"];
};

/**
 * The reservation contact a signed-in, already-linked customer books with.
 * The email is the immutable login email; the name and phone come from the
 * linked Dotypos profile and are only exposed when they satisfy the
 * reservation contact rules.
 */
type CustomerAccountContact = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
};

/**
 * The contact an account books with: its linked profile's, or a review
 * account's synthetic one, which has no Dotypos customer behind it.
 */
type BookingContact = Omit<CustomerAccountContact, "dotyposCustomerId">;

const decodeContactField = <S extends Schema.Decoder<string>>(
  schema: S,
  value: string
) => Option.getOrNull(Schema.decodeUnknownOption(schema)(value));

// The Dotypos customers are the business's, in the base locale's market: the
// Workspace writes their phones in E.164 form, and staff enter others at the
// till, where a number without a country calling code is a national one of
// the base locale's region.
const storedPhoneRegion = defaultPhoneRegion(baseLocale);
const storedPhoneSchema = reservationCustomerPhoneSchema(storedPhoneRegion);

/**
 * A stored profile phone as the contact books and prefills it, when it holds
 * a valid number: as stored when it has a country calling code, otherwise in
 * international form, so a checkout in any locale reads the same number.
 */
const toContactPhone = (stored: string) => {
  const phone = decodeContactField(storedPhoneSchema, stored);
  if (phone === null || phone.startsWith("+")) return phone;
  return Option.match(parsePhoneNumber(phone, storedPhoneRegion), {
    onNone: () => phone,
    onSome: formatPhoneNumber,
  });
};

/** A linked profile as the reservation contact its account books with. */
const toContact = (
  account: CurrentLinkedAccount,
  profile: CustomerProfile
): CustomerAccountContact | null => {
  const name = decodeContactField(
    reservationCustomerNameSchema,
    [profile.firstName, profile.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ")
  );
  if (!name) return null;

  return {
    accountId: account.accountId,
    dotyposCustomerId: account.dotyposCustomerId,
    name,
    email: account.email,
    phone: profile.phone ? toContactPhone(profile.phone) : null,
  } satisfies CustomerAccountContact;
};

interface ICustomerAccountContactService {
  /**
   * Reads a linked account's Dotypos profile into its reservation contact.
   * The profile read re-checks account activity; a profile whose name
   * cannot book a reservation yields null.
   */
  readonly linkedContact: (
    account: CurrentLinkedAccount
  ) => Effect.Effect<CustomerAccountContact | null, CustomerAccountAccessError>;
  /**
   * Reads the current account's booking contact from its standing's stored
   * link (`CurrentCustomerAccount.peek`), never claiming one, so it is safe
   * both on read-only pages and inside the account activity guard. A review
   * account books with its synthetic contact. Anonymous, deletion-pending,
   * and other unlinked sessions, and profiles whose name cannot book a
   * reservation, yield null. An unlinked account whose review marker can't
   * be read fails as the link read does.
   */
  readonly current: Effect.Effect<
    BookingContact | null,
    CustomerAccountAccessError
  >;
  /**
   * Saves the first profile of a signed-in account that has none, creating
   * or finding its Dotypos customer, and reads it back as the reservation
   * contact. The profile creation holds the account's section, or runs
   * under the enclosing section's hold of this account; a profile whose
   * name can't book yields null.
   */
  readonly completeProfile: (
    account: { readonly accountId: CustomerAccountId; readonly email: string },
    profile: CustomerProfileSave
  ) => Effect.Effect<CustomerAccountContact | null, CustomerAccountAccessError>;
}

export class CustomerAccountContactService extends Context.Service<
  CustomerAccountContactService,
  ICustomerAccountContactService
>()("@deskohub-workspace/account/CustomerAccountContactService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const currentAccount = yield* CurrentCustomerAccount;
      const profiles = yield* CustomerProfileService;

      const linkedContact = Effect.fn(
        "CustomerAccountContactService.linkedContact"
      )(function* (account: CurrentLinkedAccount) {
        const profile = yield* profiles.load({
          accountId: account.accountId,
          dotyposCustomerId: account.dotyposCustomerId,
        });
        return toContact(account, profile);
      });

      const completeProfile = Effect.fn(
        "CustomerAccountContactService.completeProfile"
      )(function* (
        account: {
          readonly accountId: CustomerAccountId;
          readonly email: string;
        },
        input: CustomerProfileSave
      ) {
        const created = yield* profiles.create(account.accountId, input);
        return toContact(
          { ...created.account, email: account.email },
          created.profile
        );
      });

      /** The booking contact's own policy over the standing. */
      const contactFor = (
        standing: Effect.Success<CurrentCustomerAccount["Service"]["peek"]>
      ): Effect.Effect<BookingContact | null, CustomerAccountAccessError> => {
        switch (standing.kind) {
          case "signed-out":
          case "deletion-pending":
            return Effect.succeed(null);
          case "unverified":
            // As the session read reports it.
            return Effect.fail(
              new CustomerAccountAccessError({ reason: "unverified-email" })
            );
          case "review":
            return Effect.succeed({
              accountId: standing.session.accountId,
              ...getReviewAccountContact(standing.session.email),
            });
          case "unlinked":
            // Without knowing it isn't a review account, the account has no
            // contact; this is the failure its marker read reported.
            return standing.reviewMarker === "unreadable"
              ? Effect.fail(customerAccountUnavailable("account-link.read"))
              : Effect.succeed(null);
          case "linked":
            return linkedContact({
              ...standing.account,
              email: standing.session.email,
            });
          case "unavailable":
            return Effect.fail(standing.failure);
        }
      };

      const current = currentAccount.peek.pipe(
        Effect.flatMap(contactFor),
        Effect.withSpan("CustomerAccountContactService.current")
      );

      return {
        completeProfile,
        linkedContact,
        current,
      } satisfies ICustomerAccountContactService;
    })
  );

  /**
   * The service reading the customer through the `CustomerAuthentication`
   * the caller provides, over the same standing and profile service those
   * services build.
   */
  static ForProvidedAuthentication = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CurrentCustomerAccount.ForProvidedAuthentication,
        CustomerProfileService.ForProvidedAuthentication
      )
    )
  );

  /** The service reading the browser session. */
  static Live = this.ForProvidedAuthentication.pipe(
    Layer.provide(CustomerAuthentication.Default)
  );
}

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer, Match, Option, Schema } from "effect";
import {
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import {
  getReviewAccountContact,
  ReviewAccounts,
} from "@/features/review-accounts";
import type { CustomerProfile, CustomerProfileInput } from "../contracts";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { CustomerProfileService } from "./customer-profile.service";

/**
 * The current session's durable Dotypos link with its login email, before
 * the profile is read. Work that needs only the linked customer can start
 * from here.
 */
export type CurrentLinkedAccount = LinkedCustomerAccount & {
  readonly email: CustomerAccountSession["email"];
};

/**
 * The current session's account before any profile is read: signed out,
 * signed in without a Dotypos profile linked yet, or linked. A session with
 * deletion pending reads as signed out, since it can't book or link.
 */
type CurrentCustomerAccount =
  | { readonly status: "signed-out" }
  | {
      readonly status: "unlinked";
      readonly accountId: CustomerAccountId;
      readonly email: CustomerAccountSession["email"];
    }
  | ({ readonly status: "linked" } & CurrentLinkedAccount);

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
    phone: profile.phone
      ? decodeContactField(reservationCustomerPhoneSchema, profile.phone)
      : null,
  } satisfies CustomerAccountContact;
};

interface ICustomerAccountContactService {
  /** Reads the current session's account without claiming a link. */
  readonly currentAccount: Effect.Effect<
    CurrentCustomerAccount,
    CustomerAccountAccessError
  >;
  /**
   * Reads the current session's existing link without claiming one.
   * Anonymous, deletion-pending, and unlinked sessions yield null.
   */
  readonly currentLinkedAccount: Effect.Effect<
    CurrentLinkedAccount | null,
    CustomerAccountAccessError
  >;
  /**
   * Reads a linked account's Dotypos profile into its reservation contact.
   * The profile read re-checks account activity; a profile whose name
   * cannot book a reservation yields null.
   */
  readonly linkedContact: (
    account: CurrentLinkedAccount
  ) => Effect.Effect<CustomerAccountContact | null, CustomerAccountAccessError>;
  /**
   * Reads the current account's booking contact without claiming a link, so
   * it is safe both on read-only pages and inside the account activity
   * guard. A review account books with its synthetic contact. Anonymous,
   * deletion-pending, and other unlinked sessions, and profiles whose name
   * cannot book a reservation, yield null.
   */
  readonly current: Effect.Effect<
    BookingContact | null,
    CustomerAccountAccessError
  >;
  /**
   * Saves the first profile of a signed-in account that has none, creating
   * or finding its Dotypos customer, and reads it back as the reservation
   * contact. Run it inside the account activity guard, which holds the
   * account lock; a profile whose name can't book yields null.
   */
  readonly completeProfileUnderHeldLock: (
    account: { readonly accountId: CustomerAccountId; readonly email: string },
    profile: CustomerProfileInput
  ) => Effect.Effect<CustomerAccountContact | null, CustomerAccountAccessError>;
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
      const reviewAccounts = yield* ReviewAccounts;

      const currentAccount = Effect.gen(function* () {
        const session = yield* authentication.currentUser;
        if (!session || session.deletionRequested) {
          return { status: "signed-out" } satisfies CurrentCustomerAccount;
        }

        const dotyposCustomerId = yield* links
          .find(session.accountId)
          .pipe(
            Effect.mapError(mapCustomerAccountFailure("account-link.read"))
          );
        if (!dotyposCustomerId) {
          return {
            status: "unlinked",
            accountId: session.accountId,
            email: session.email,
          } satisfies CurrentCustomerAccount;
        }

        return {
          status: "linked",
          accountId: session.accountId,
          dotyposCustomerId,
          email: session.email,
        } satisfies CurrentCustomerAccount;
      }).pipe(Effect.withSpan("CustomerAccountContactService.currentAccount"));

      const currentLinkedAccount = currentAccount.pipe(
        Effect.map((account): CurrentLinkedAccount | null =>
          account.status === "linked"
            ? {
                accountId: account.accountId,
                dotyposCustomerId: account.dotyposCustomerId,
                email: account.email,
              }
            : null
        ),
        Effect.withSpan("CustomerAccountContactService.currentLinkedAccount")
      );

      const linkedContact = Effect.fn(
        "CustomerAccountContactService.linkedContact"
      )(function* (account: CurrentLinkedAccount) {
        const profile = yield* profiles.load({
          accountId: account.accountId,
          dotyposCustomerId: account.dotyposCustomerId,
        });
        return toContact(account, profile);
      });

      const completeProfileUnderHeldLock = Effect.fn(
        "CustomerAccountContactService.completeProfileUnderHeldLock"
      )(function* (
        account: {
          readonly accountId: CustomerAccountId;
          readonly email: string;
        },
        input: CustomerProfileInput
      ) {
        const created = yield* profiles.createUnderHeldLock(
          account.accountId,
          account.email,
          input
        );
        return toContact(
          { ...created.account, email: account.email },
          created.profile
        );
      });

      const unlinkedContact = (account: {
        readonly accountId: CustomerAccountId;
        readonly email: string;
      }) =>
        reviewAccounts.isReviewAccount(account.accountId).pipe(
          Effect.mapError(mapCustomerAccountFailure("account-link.read")),
          Effect.map((review): BookingContact | null =>
            review
              ? {
                  accountId: account.accountId,
                  ...getReviewAccountContact(account.email),
                }
              : null
          )
        );

      const current = currentAccount.pipe(
        Effect.flatMap(
          (
            account
          ): Effect.Effect<BookingContact | null, CustomerAccountAccessError> =>
            Match.value(account).pipe(
              Match.discriminatorsExhaustive("status")({
                "signed-out": () => Effect.succeed(null),
                unlinked: unlinkedContact,
                linked: linkedContact,
              })
            )
        ),
        Effect.withSpan("CustomerAccountContactService.current")
      );

      return {
        currentAccount,
        completeProfileUnderHeldLock,
        currentLinkedAccount,
        linkedContact,
        current,
      } satisfies ICustomerAccountContactService;
    })
  );

  /**
   * The service reading the customer through this authentication, such as
   * an agent's access token instead of the browser session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          authentication,
          CustomerAccountLinkRepository.Live,
          CustomerProfileService.Live,
          ReviewAccounts.Live
        )
      )
    );

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}

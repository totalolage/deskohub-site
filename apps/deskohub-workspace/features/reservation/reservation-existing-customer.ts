import type {
  WorkspaceCoworkCurrentTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { ReservationBillingSelectionInput } from "@/features/reservation/reservation-billing";
import type { ReservationCheckoutContact } from "@/features/reservation/reservation-checkout-contact";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";

/** The account contact a signed-in, linked customer books with. */
export type ReservationAccountContact = {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
};

/**
 * Reservation options from the customer's latest confirmed reservation of a
 * family, used as fallback defaults below explicit query values.
 */
export type CustomerLastReservation =
  | {
      readonly kind: "cowork";
      readonly entryTier: WorkspaceCoworkCurrentTier;
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | {
      readonly kind: "meeting-room";
      readonly duration: MeetingRoomReservationDurationKey;
    }
  | {
      readonly kind: "office";
      readonly dayCount: number;
      readonly seats: number;
    };

export type CustomerLastReservationForKind<
  Kind extends WorkspaceReservationKind,
> = Extract<CustomerLastReservation, { readonly kind: Kind }>;

export type ReservationExistingCustomer<
  Kind extends WorkspaceReservationKind = WorkspaceReservationKind,
> = {
  readonly contact: ReservationAccountContact;
  /** Whether the customer currently consents to marketing communications. */
  readonly hasMarketingConsent: boolean;
  readonly lastReservation?: CustomerLastReservationForKind<Kind>;
};

/**
 * Who reaches a reservation page's contact-details step. Only a signed-in
 * account with a verified email books, so a signed-out visitor verifies the
 * email first, and an account without a usable profile saves one on the way.
 */
export type ReservationCheckoutAccount<
  Kind extends WorkspaceReservationKind = WorkspaceReservationKind,
> =
  | { readonly status: "signed-out" }
  | { readonly status: "profile-missing"; readonly email: string }
  | {
      readonly status: "linked";
      readonly customer: ReservationExistingCustomer<Kind>;
    }
  /**
   * The verified email's Dotypos customers can't be linked safely, so the
   * account can't book as itself until support connects it.
   */
  | { readonly status: "support-required" }
  /** The session or its profile couldn't be read. */
  | { readonly status: "unavailable" }
  /**
   * An app-directory review account, which books its simulated holds with
   * a synthetic contact and never with a profile.
   */
  | {
      readonly status: "review-account";
      readonly contact: ReservationAccountContact;
    };

/**
 * Whether the reservation form opens on the account card or on the contact
 * inputs. The card books as the signed-in customer; the inputs book for the
 * typed contact.
 */
export type ReservationCustomerMode = "account" | "contact";

export type ReservationContactValues = {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
};

/** What the reservation form needs to offer the account card. */
export type ReservationExistingCustomerForm = {
  readonly contact: ReservationAccountContact;
  /**
   * Whether the account already consents to marketing communications, so the
   * account card does not ask again.
   */
  readonly hasMarketingConsent: boolean;
  readonly initialMode: ReservationCustomerMode;
  /** The contact inputs "book for someone else" opens with. */
  readonly otherContact: ReservationContactValues;
};

const emptyReservationContact: ReservationContactValues = {
  name: "",
  email: "",
  phone: "",
};

/**
 * The form values that book as the account: the immutable login email and
 * the profile name, with the profile phone when it has one.
 */
export const getAccountContactValues = (
  contact: ReservationAccountContact,
  phone: string
): ReservationContactValues => ({
  name: contact.name,
  email: contact.email,
  phone: contact.phone ?? phone,
});

const isAccountContact = (
  contact: ReservationAccountContact,
  values: ReservationContactValues
) =>
  values.name === contact.name &&
  values.email.toLowerCase() === contact.email.toLowerCase() &&
  (contact.phone === null || values.phone === contact.phone);

/**
 * Seeds the reservation form for a signed-in customer. A restored checkout
 * reopens in the mode it was submitted in; otherwise an explicit contact
 * link opens the contact inputs and everything else opens the account card.
 */
export const getReservationExistingCustomerForm = <
  Values extends ReservationContactValues,
>({
  contact,
  hasMarketingConsent,
  queryMode,
  restored,
  values,
}: {
  readonly contact: ReservationAccountContact;
  readonly hasMarketingConsent: boolean;
  readonly queryMode: ReservationCustomerMode | undefined;
  readonly restored: boolean;
  readonly values: Values;
}): {
  readonly existingCustomer: ReservationExistingCustomerForm;
  readonly initialValues: Values;
} => {
  const restoredAccount = restored && isAccountContact(contact, values);
  const initialMode: ReservationCustomerMode =
    restoredAccount || (!restored && queryMode !== "contact")
      ? "account"
      : "contact";

  return {
    existingCustomer: {
      contact,
      hasMarketingConsent,
      initialMode,
      otherContact: restoredAccount
        ? emptyReservationContact
        : { name: values.name, email: values.email, phone: values.phone },
    },
    initialValues:
      initialMode === "account"
        ? { ...values, ...getAccountContactValues(contact, values.phone) }
        : values,
  };
};

/** What the reservation form needs for its contact-details step. */
export type ReservationCheckoutCustomerForm =
  | { readonly status: "signed-out" }
  | { readonly status: "support-required" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "profile-missing";
      /** The account's login email, which the profile books with. */
      readonly email: string;
      /**
       * Whether the page carries the details typed before this account's
       * email was verified, so the form saves them and continues to payment
       * without another submission.
       */
      readonly continuesCheckout: boolean;
    }
  | {
      readonly status: "linked";
      readonly existingCustomer: ReservationExistingCustomerForm;
      /**
       * Whether the verified email turned out to have a saved profile, which
       * replaces the details typed before the verification.
       */
      readonly replacesTypedContact: boolean;
    }
  /** A review account books only as itself, on the account card. */
  | {
      readonly status: "review-account";
      readonly existingCustomer: ReservationExistingCustomerForm;
    };

type ReservationCheckoutFormValues = ReservationContactValues & {
  readonly billing?: ReservationBillingSelectionInput;
  readonly marketingConsent?: boolean;
};

const isSameEmail = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * Seeds the reservation form's contact-details step. Details typed before an
 * email verification (`checkoutContact`) refill the form: a signed-out
 * visitor gets them back, an account without a profile books with them on its
 * own email, and an account with a saved profile keeps the profile and offers
 * them, minus the email, for booking for someone else.
 */
export const getReservationCheckoutCustomerForm = <
  Kind extends WorkspaceReservationKind,
  Values extends ReservationCheckoutFormValues,
>({
  account,
  checkoutContact,
  queryMode,
  restored,
  values,
}: {
  readonly account: ReservationCheckoutAccount<Kind>;
  readonly checkoutContact: ReservationCheckoutContact | undefined;
  readonly queryMode: ReservationCustomerMode | undefined;
  readonly restored: boolean;
  readonly values: Values;
}): {
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly initialValues: Values;
} => {
  const typedValues: Values = checkoutContact
    ? {
        ...values,
        name: checkoutContact.name,
        email: checkoutContact.email,
        phone: checkoutContact.phone,
        billing: checkoutContact.billing,
        marketingConsent: checkoutContact.marketingConsent,
      }
    : values;

  if (
    account.status === "signed-out" ||
    account.status === "support-required" ||
    account.status === "unavailable"
  ) {
    return {
      checkoutCustomer: { status: account.status },
      initialValues: typedValues,
    };
  }

  if (account.status === "review-account") {
    return {
      checkoutCustomer: {
        status: "review-account",
        existingCustomer: {
          contact: account.contact,
          // The simulated booking records no consent, so it never asks.
          hasMarketingConsent: true,
          initialMode: "account",
          otherContact: emptyReservationContact,
        },
      },
      initialValues: {
        ...typedValues,
        ...getAccountContactValues(account.contact, typedValues.phone),
      },
    };
  }

  if (account.status === "profile-missing") {
    return {
      checkoutCustomer: {
        status: "profile-missing",
        email: account.email,
        continuesCheckout: Boolean(
          checkoutContact && isSameEmail(checkoutContact.email, account.email)
        ),
      },
      initialValues: { ...typedValues, email: account.email },
    };
  }

  const { existingCustomer, initialValues } =
    getReservationExistingCustomerForm({
      contact: account.customer.contact,
      hasMarketingConsent: account.customer.hasMarketingConsent,
      queryMode: checkoutContact ? "account" : queryMode,
      restored: restored && !checkoutContact,
      values: typedValues,
    });

  return {
    checkoutCustomer: {
      status: "linked",
      existingCustomer: checkoutContact
        ? {
            ...existingCustomer,
            otherContact: {
              name: checkoutContact.name,
              email: "",
              phone: checkoutContact.phone,
            },
          }
        : existingCustomer,
      replacesTypedContact: Boolean(checkoutContact),
    },
    // A contact carried in by a link or a restored checkout was entered
    // before, so it opens confirmed.
    initialValues:
      existingCustomer.initialMode === "contact"
        ? { ...initialValues, emailConfirmation: initialValues.email }
        : initialValues,
  };
};

/** The linked customer's latest reservation of the page's family, if any. */
export const getCheckoutAccountLastReservation = <
  Kind extends WorkspaceReservationKind,
>(
  account: ReservationCheckoutAccount<Kind>
) =>
  account.status === "linked" ? account.customer.lastReservation : undefined;

import type {
  WorkspaceCoworkCurrentTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
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
  readonly lastReservation?: CustomerLastReservationForKind<Kind>;
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
  queryMode,
  restored,
  values,
}: {
  readonly contact: ReservationAccountContact;
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

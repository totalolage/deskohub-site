import "server-only";

import { Effect, Layer, Result } from "effect";
import { cache } from "react";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  type CurrentLinkedAccount,
  CustomerAccountContactService,
} from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import type { MeetingRoomReservationInput } from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import type {
  ReservationCheckoutAccount,
  ReservationExistingCustomer,
} from "@/features/reservation/reservation-existing-customer";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import {
  getMeetingRoomAvailabilityQuery,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { getReviewAccountContact } from "@/features/review-accounts";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CustomerLastReservationService } from "./customer-last-reservation.service";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";

/**
 * Who reaches a reservation page's contact-details step: signed out, signed
 * in without a usable profile, signed in with an email only support can link,
 * or the linked customer the page books for by default, with their latest
 * reservation of the page's family. An account that can't be read is
 * `unavailable`, so the page offers a retry instead of booking as someone it
 * doesn't know; without account configuration, every visitor is signed out.
 */
export const loadReservationCheckoutAccount = cache(
  async <Kind extends WorkspaceReservationKind>(
    kind: Kind
  ): Promise<ReservationCheckoutAccount<Kind>> => {
    const account = await loadCheckoutAccount(kind).pipe(
      Effect.provide(
        Layer.mergeAll(
          CurrentCustomerAccount.Live,
          CustomerAccountContactService.Live,
          CustomerLastReservationService.Live,
          MarketingConsentLedger.Live
        )
      ),
      Effect.tapError((error) =>
        error._tag === "CustomerAccountAccessError" &&
        error.reason === "not-configured"
          ? Effect.void
          : Effect.logError("Reservation account contact load failed", {
              error,
            })
      ),
      Effect.result,
      runWorkspaceEffect("reservation.existing-customer", { boundary: "page" })
    );

    if (Result.isSuccess(account)) return account.success;
    return account.failure._tag === "CustomerAccountAccessError" &&
      account.failure.reason === "not-configured"
      ? { status: "signed-out" }
      : { status: "unavailable" };
  }
);

type CheckoutStanding = Effect.Success<
  CurrentCustomerAccount["Service"]["peek" | "resolve"]
>;

/**
 * Checkout's own policy over the account's standing. It deliberately differs
 * from the account page's: an account awaiting deletion books as signed out,
 * and an unverified email is unavailable.
 */
const checkoutAccountFor = Effect.fnUntraced(function* <
  Kind extends WorkspaceReservationKind,
>(standing: CheckoutStanding, kind: Kind) {
  switch (standing.kind) {
    case "signed-out":
    case "deletion-pending":
      return {
        status: "signed-out",
      } satisfies ReservationCheckoutAccount<Kind>;
    case "unverified":
      // As the session read reports it, so the page logs it as before.
      return yield* new CustomerAccountAccessError({
        reason: "unverified-email",
      });
    case "review":
      return {
        status: "review-account",
        contact: getReviewAccountContact(standing.session.email),
      } satisfies ReservationCheckoutAccount<Kind>;
    case "unlinked":
      // Only an unreadable review marker leaves an account unlinked here:
      // without knowing it isn't a review account, checkout can't link it.
      return {
        status: "unavailable",
      } satisfies ReservationCheckoutAccount<Kind>;
    case "linked":
      return yield* loadLinkedCheckoutAccount(
        { ...standing.account, email: standing.session.email },
        kind
      );
    case "profile-missing":
      return {
        status: "profile-missing",
        email: standing.session.email,
      } satisfies ReservationCheckoutAccount<Kind>;
    case "support-required":
      return {
        status: "support-required",
      } satisfies ReservationCheckoutAccount<Kind>;
    case "unavailable":
      return yield* standing.failure;
  }
});

/** The session ended or requested deletion since the first read. */
const endedSinceRead = (failure: CustomerAccountAccessError) =>
  failure.reason === "unauthenticated" || failure.reason === "link-required";

const signedOut = { kind: "signed-out" } as const;

/**
 * The standing of an account the first read found unlinked, after it
 * resolves its link. A session that ended or requested deletion since that
 * read books as signed out.
 */
const resolveUnlinkedAccount = CurrentCustomerAccount.pipe(
  Effect.flatMap((current) => current.resolve),
  Effect.catchIf(endedSinceRead, () => Effect.succeed(signedOut)),
  Effect.map(
    (standing): CheckoutStanding =>
      standing.kind === "unavailable" && endedSinceRead(standing.failure)
        ? signedOut
        : standing
  )
);

const loadCheckoutAccount = Effect.fn("reservation.loadCheckoutAccount")(
  function* <Kind extends WorkspaceReservationKind>(kind: Kind) {
    const current = yield* CurrentCustomerAccount;
    const peeked = yield* current.peek;
    // As on the account page, an account without a link first claims its
    // exact-email Dotypos customer, so a returning customer books with the
    // saved profile instead of creating another one. A linked account never
    // resolves, so it loads without taking the account lock.
    const standing =
      peeked.kind === "unlinked" && peeked.reviewMarker === "absent"
        ? yield* resolveUnlinkedAccount
        : peeked;
    return yield* checkoutAccountFor(standing, kind);
  }
);

const loadLinkedCheckoutAccount = Effect.fn(
  "reservation.loadLinkedCheckoutAccount"
)(function* <Kind extends WorkspaceReservationKind>(
  account: CurrentLinkedAccount,
  kind: Kind
) {
  const customer = yield* loadLinkedExistingCustomer(account, kind);
  return customer
    ? ({
        status: "linked",
        customer,
      } satisfies ReservationCheckoutAccount<Kind>)
    : ({
        status: "profile-missing",
        email: account.email,
      } satisfies ReservationCheckoutAccount<Kind>);
});

/**
 * The profile, last-reservation, and marketing-consent reads each issue a
 * database query (the first two plus a Dotypos call), so a signed-in page load
 * holds at most three pool connections for this step.
 */
const linkedCustomerReadConcurrency = 3;

/**
 * The contact, the last reservation, and the marketing consent need only the
 * account's link, so they load concurrently once it resolves. The contact
 * decides the outcome: when it fails or cannot book, the others are discarded.
 */
export const loadLinkedExistingCustomer = Effect.fn(
  "reservation.loadLinkedExistingCustomer"
)(function* <Kind extends WorkspaceReservationKind>(
  account: CurrentLinkedAccount,
  kind: Kind
) {
  const contacts = yield* CustomerAccountContactService;

  const lastReservations = yield* CustomerLastReservationService;
  const marketingConsents = yield* MarketingConsentLedger;
  const [contact, lastReservation, hasMarketingConsent] = yield* Effect.all(
    [
      contacts.linkedContact(account),
      // The remembered options only refine the defaults, so a failure keeps
      // the account card and falls back to the usual defaults.
      lastReservations.load(account.dotyposCustomerId, kind).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Customer last reservation load failed", {
            error,
          })
        ),
        Effect.orElseSucceed(() => null)
      ),
      // An unreadable consent keeps offering the optional checkbox, which
      // never overrides a stored consent or withdrawal.
      marketingConsents.status(account.dotyposCustomerId).pipe(
        Effect.map((status) => status === "active"),
        Effect.tapError((error) =>
          Effect.logWarning("Customer marketing consent load failed", {
            error,
          })
        ),
        Effect.orElseSucceed(() => false)
      ),
    ],
    { concurrency: linkedCustomerReadConcurrency }
  );
  if (!contact) return undefined;

  return {
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    },
    hasMarketingConsent,
    ...(lastReservation && { lastReservation }),
  } satisfies ReservationExistingCustomer<Kind>;
});

/**
 * Availability for a remembered reservation option. A failure is logged and
 * reads as unavailable so the form opens on the usual defaults instead.
 */
const loadRememberedOptionAvailability = (query: WorkspaceAvailabilityQuery) =>
  Effect.flatMap(WorkspaceAvailabilityService, (service) =>
    service.getAvailability({ query })
  ).pipe(
    Effect.provide(WorkspaceAvailabilityService.Live),
    Effect.tapError((error) =>
      Effect.logWarning("Remembered reservation option availability failed", {
        error,
      })
    ),
    Effect.result
  );

/** Whether a remembered cowork offer is still bookable on the form's date. */
export const isRememberedCoworkOfferAvailable = Effect.fn(
  "reservation.isRememberedCoworkOfferAvailable"
)(function* ({
  date,
  entryTier,
  monitorOption,
}: Pick<CoworkReservationInput, "date" | "entryTier" | "monitorOption">) {
  const offer = { date, entryTier, ...(monitorOption && { monitorOption }) };
  const availability = yield* loadRememberedOptionAvailability({
    kind: "cowork",
    from: date,
    to: date,
    ...offer,
  });

  return (
    Result.isSuccess(availability) &&
    isCoworkOfferAvailable(availability.success, offer)
  );
});

/** Whether the meeting room is free for a remembered duration. */
export const isRememberedMeetingRoomReservationAvailable = Effect.fn(
  "reservation.isRememberedMeetingRoomReservationAvailable"
)(function* ({
  duration,
  startDateTime,
}: Pick<MeetingRoomReservationInput, "duration" | "startDateTime">) {
  const interval = getMeetingRoomReservationInterval(
    startDateTime,
    getMeetingRoomReservationDuration(duration)
  );
  if (!interval) return false;

  const availability = yield* loadRememberedOptionAvailability(
    getMeetingRoomAvailabilityQuery(interval)
  );

  return (
    Result.isSuccess(availability) &&
    isMeetingRoomAvailable(availability.success)
  );
});

import "server-only";

import { Effect, Layer, Result } from "effect";
import { cache } from "react";
import {
  type CurrentLinkedAccount,
  CustomerAccountContactService,
} from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  isCustomerAccountSupportRequired,
  isCustomerProfileMissing,
} from "@/features/account/customer-account";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { getMarketingPreferenceStatus } from "@/features/legal/marketing-preferences";
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
import {
  getReviewAccountContact,
  ReviewAccounts,
} from "@/features/review-accounts";
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
          CustomerAccountContactService.Live,
          CustomerAccountResolver.Live,
          CustomerLastReservationService.Live,
          CustomerMarketingConsentRepository.Live,
          ReviewAccounts.Live
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

const loadCheckoutAccount = Effect.fn("reservation.loadCheckoutAccount")(
  function* <Kind extends WorkspaceReservationKind>(kind: Kind) {
    const contacts = yield* CustomerAccountContactService;
    const account = yield* contacts.currentAccount;
    if (account.status === "signed-out") {
      return {
        status: "signed-out",
      } satisfies ReservationCheckoutAccount<Kind>;
    }
    if (account.status === "linked") {
      return yield* loadLinkedCheckoutAccount(account, kind);
    }
    const reviewAccount = yield* ReviewAccounts.pipe(
      Effect.flatMap((accounts) => accounts.isReviewAccount(account.accountId))
    );
    if (reviewAccount) {
      return {
        status: "review-account",
        contact: getReviewAccountContact(account.email),
      } satisfies ReservationCheckoutAccount<Kind>;
    }

    // As on the account page, an account without a link first claims its
    // exact-email Dotypos customer, so a returning customer books with the
    // saved profile instead of creating another one.
    const resolution = yield* CustomerAccountResolver.pipe(
      Effect.flatMap((resolver) => resolver.resolve),
      Effect.result
    );
    if (Result.isSuccess(resolution)) {
      return yield* loadLinkedCheckoutAccount(
        { ...resolution.success, email: account.email },
        kind
      );
    }

    const failure = resolution.failure;
    if (isCustomerProfileMissing(failure)) {
      return {
        status: "profile-missing",
        email: account.email,
      } satisfies ReservationCheckoutAccount<Kind>;
    }
    if (isCustomerAccountSupportRequired(failure)) {
      return {
        status: "support-required",
      } satisfies ReservationCheckoutAccount<Kind>;
    }
    // The session ended or requested deletion since it was read.
    if (
      failure.reason === "unauthenticated" ||
      failure.reason === "link-required"
    ) {
      return {
        status: "signed-out",
      } satisfies ReservationCheckoutAccount<Kind>;
    }
    return yield* failure;
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
  const marketingConsents = yield* CustomerMarketingConsentRepository;
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
      marketingConsents.get(account.dotyposCustomerId).pipe(
        Effect.map(
          (consent) => getMarketingPreferenceStatus(consent) === "active"
        ),
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
const loadRememberedOptionAvailability = (
  name: string,
  query: WorkspaceAvailabilityQuery
) =>
  Effect.flatMap(WorkspaceAvailabilityService, (service) =>
    service.getAvailability({ query })
  ).pipe(
    Effect.provide(WorkspaceAvailabilityService.Live),
    Effect.tapError((error) =>
      Effect.logWarning("Remembered reservation option availability failed", {
        error,
      })
    ),
    Effect.result,
    runWorkspaceEffect(name, { boundary: "page" })
  );

/** Whether a remembered cowork offer is still bookable on the form's date. */
export const isRememberedCoworkOfferAvailable = async ({
  date,
  entryTier,
  monitorOption,
}: Pick<CoworkReservationInput, "date" | "entryTier" | "monitorOption">) => {
  const offer = { date, entryTier, ...(monitorOption && { monitorOption }) };
  const availability = await loadRememberedOptionAvailability(
    "reservation.cowork.remembered-offer-availability",
    { kind: "cowork", from: date, to: date, ...offer }
  );

  return (
    Result.isSuccess(availability) &&
    isCoworkOfferAvailable(availability.success, offer)
  );
};

/** Whether the meeting room is free for a remembered duration. */
export const isRememberedMeetingRoomReservationAvailable = async ({
  duration,
  startDateTime,
}: Pick<MeetingRoomReservationInput, "duration" | "startDateTime">) => {
  const interval = getMeetingRoomReservationInterval(
    startDateTime,
    getMeetingRoomReservationDuration(duration)
  );
  if (!interval) return false;

  const availability = await loadRememberedOptionAvailability(
    "reservation.meeting-room.remembered-duration-availability",
    getMeetingRoomAvailabilityQuery(interval)
  );

  return (
    Result.isSuccess(availability) &&
    isMeetingRoomAvailable(availability.success)
  );
};

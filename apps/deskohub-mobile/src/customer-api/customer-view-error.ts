import type {
  CustomerAccessCodeUnavailable,
  CustomerAccountLinkRequired,
  CustomerAuthRejected,
  CustomerAvatarRejected,
  CustomerFeatureUnavailable,
  CustomerInvoiceNotIssued,
  CustomerMarketingPreferencesRejected,
  CustomerRateLimited,
  CustomerRequestRejected,
  CustomerReservationNotFound,
  CustomerServiceUnavailable,
  CustomerSessionRequired,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Match, Option, type Schema } from "effect";
import type { HttpClientError } from "effect/unstable/http";
import type {
  CustomerRequestTimedOut,
  CustomerWriteUnconfirmed,
} from "./customer-request";

/** Every failure a customer request run through `customerRead`/`customerWrite` can end in. */
export type CustomerRequestFailure =
  | CustomerSessionRequired
  | CustomerRequestRejected
  | CustomerRateLimited
  | CustomerServiceUnavailable
  | CustomerAccountLinkRequired
  | CustomerFeatureUnavailable
  | CustomerAvatarRejected
  | CustomerMarketingPreferencesRejected
  | CustomerReservationNotFound
  | CustomerAccessCodeUnavailable
  | CustomerInvoiceNotIssued
  | CustomerAuthRejected
  | CustomerRequestTimedOut
  | CustomerWriteUnconfirmed
  | HttpClientError.HttpClientError
  | Schema.SchemaError;

/** What a screen shows for a failed customer request. */
export type CustomerViewError = Data.TaggedEnum<{
  /** The session is being re-checked; the guard redirects if it is gone. */
  SessionRequired: Record<never, never>;
  /** The account's request budget is spent: wait, don't retry now. */
  RateLimited: Record<never, never>;
  /** No answer or a temporary server failure; retrying can help. */
  Unavailable: Record<never, never>;
  /** No answer in time; retrying can help. */
  TimedOut: Record<never, never>;
  /** A write may have been applied; the screen refetches and shows that. */
  Unconfirmed: Record<never, never>;
  /** The account has no usable profile for this; refetch the account. */
  LinkRequired: { readonly reason: CustomerAccountLinkRequired["reason"] };
  /** The release withholds the feature; hide it. */
  FeatureUnavailable: {
    readonly feature: CustomerFeatureUnavailable["feature"];
  };
  NotFound: Record<never, never>;
  AccessCodeUnavailable: Record<never, never>;
  InvoiceNotIssued: Record<never, never>;
  AvatarRejected: { readonly reason: CustomerAvatarRejected["reason"] };
  /** The preference changed elsewhere; read it again before saving. */
  MarketingPreferencesStale: Record<never, never>;
  AuthRejected: {
    readonly reason: CustomerAuthRejected["reason"];
    readonly code: string | undefined;
  };
  /** A client or contract fault; retrying may not help. */
  Unexpected: Record<never, never>;
}>;

export const CustomerViewError = Data.taggedEnum<CustomerViewError>();

const fromHttpClientError = (error: HttpClientError.HttpClientError) =>
  Match.value(error.reason).pipe(
    Match.tagsExhaustive({
      TransportError: () => CustomerViewError.Unavailable(),
      // An answer the contract doesn't declare, such as a gateway 502.
      StatusCodeError: () => CustomerViewError.Unavailable(),
      DecodeError: () => CustomerViewError.Unexpected(),
      EmptyBodyError: () => CustomerViewError.Unexpected(),
      EncodeError: () => CustomerViewError.Unexpected(),
      InvalidUrlError: () => CustomerViewError.Unexpected(),
    })
  );

export const toCustomerViewError = (
  error: CustomerRequestFailure
): CustomerViewError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      CustomerSessionRequired: () => CustomerViewError.SessionRequired(),
      CustomerRequestRejected: () => CustomerViewError.Unexpected(),
      CustomerRateLimited: () => CustomerViewError.RateLimited(),
      CustomerServiceUnavailable: () => CustomerViewError.Unavailable(),
      CustomerAccountLinkRequired: ({ reason }) =>
        CustomerViewError.LinkRequired({ reason }),
      CustomerFeatureUnavailable: ({ feature }) =>
        CustomerViewError.FeatureUnavailable({ feature }),
      CustomerAvatarRejected: ({ reason }) =>
        CustomerViewError.AvatarRejected({ reason }),
      CustomerMarketingPreferencesRejected: () =>
        CustomerViewError.MarketingPreferencesStale(),
      CustomerReservationNotFound: () => CustomerViewError.NotFound(),
      CustomerAccessCodeUnavailable: () =>
        CustomerViewError.AccessCodeUnavailable(),
      CustomerInvoiceNotIssued: () => CustomerViewError.InvoiceNotIssued(),
      CustomerAuthRejected: ({ reason, code }) =>
        CustomerViewError.AuthRejected({ reason, code }),
      CustomerRequestTimedOut: () => CustomerViewError.TimedOut(),
      CustomerWriteUnconfirmed: () => CustomerViewError.Unconfirmed(),
      HttpClientError: fromHttpClientError,
      SchemaError: () => CustomerViewError.Unexpected(),
    })
  );

/** The view error of a failed result; a defect or interruption is unexpected. */
export const viewErrorOf = <E extends CustomerRequestFailure>(
  cause: Cause.Cause<E>
): CustomerViewError =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => CustomerViewError.Unexpected(),
    onSome: toCustomerViewError,
  });

/** Whether a "Try again" action makes sense for the failure. */
export const isRetryableViewError = (error: CustomerViewError) =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      Unavailable: () => true,
      TimedOut: () => true,
      Unexpected: () => true,
      SessionRequired: () => false,
      RateLimited: () => false,
      Unconfirmed: () => false,
      LinkRequired: () => false,
      FeatureUnavailable: () => false,
      NotFound: () => false,
      AccessCodeUnavailable: () => false,
      InvoiceNotIssued: () => false,
      AvatarRejected: () => false,
      MarketingPreferencesStale: () => false,
      AuthRejected: () => false,
    })
  );

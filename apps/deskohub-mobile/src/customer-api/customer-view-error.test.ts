import { describe, expect, test } from "bun:test";
import {
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
import { Cause } from "effect";
import {
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  CustomerRequestTimedOut,
  CustomerWriteUnconfirmed,
} from "./customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  isRetryableViewError,
  toCustomerViewError,
  viewErrorOf,
} from "./customer-view-error";

const request = HttpClientRequest.get("https://workspace.deskohub.test/x");
const transportFailure = new HttpClientError.HttpClientError({
  reason: new HttpClientError.TransportError({ request }),
});
const undeclaredStatus = new HttpClientError.HttpClientError({
  reason: new HttpClientError.StatusCodeError({
    request,
    response: HttpClientResponse.fromWeb(
      request,
      new Response(null, { status: 502 })
    ),
  }),
});

// biome-ignore format: the case table stays one row per line on purpose.
const cases: ReadonlyArray<readonly [CustomerRequestFailure, CustomerViewError["_tag"], retryable: boolean]> = [
  [new CustomerSessionRequired(), "SessionRequired", false],
  [new CustomerRequestRejected(), "Unexpected", true],
  [new CustomerRateLimited(), "RateLimited", false],
  [new CustomerServiceUnavailable(), "Unavailable", true],
  [new CustomerAccountLinkRequired({ reason: "profile-missing" }), "LinkRequired", false],
  [new CustomerFeatureUnavailable({ feature: "referrals" }), "FeatureUnavailable", false],
  [new CustomerAvatarRejected({ reason: "file-too-large" }), "AvatarRejected", false],
  [new CustomerMarketingPreferencesRejected({ reason: "stale-context" }), "MarketingPreferencesStale", false],
  [new CustomerReservationNotFound(), "NotFound", false],
  [new CustomerAccessCodeUnavailable(), "AccessCodeUnavailable", false],
  [new CustomerInvoiceNotIssued(), "InvoiceNotIssued", false],
  [new CustomerAuthRejected({ reason: "forbidden", code: "SESSION_NOT_FRESH" }), "AuthRejected", false],
  [new CustomerRequestTimedOut(), "TimedOut", true],
  [new CustomerWriteUnconfirmed({}), "Unconfirmed", false],
  [transportFailure, "Unavailable", true],
  [undeclaredStatus, "Unavailable", true],
];

describe("toCustomerViewError", () => {
  test.each(cases)("maps %p", (failure, tag, retryable) => {
    const view = toCustomerViewError(failure);

    expect(view._tag).toBe(tag);
    expect(isRetryableViewError(view)).toBe(retryable);
  });

  test("keeps the details a screen branches on", () => {
    expect(
      toCustomerViewError(
        new CustomerAccountLinkRequired({ reason: "deletion-pending" })
      )
    ).toMatchObject({ _tag: "LinkRequired", reason: "deletion-pending" });
    expect(
      toCustomerViewError(
        new CustomerFeatureUnavailable({ feature: "passkeys" })
      )
    ).toMatchObject({ _tag: "FeatureUnavailable", feature: "passkeys" });
    expect(
      toCustomerViewError(
        new CustomerAuthRejected({
          reason: "forbidden",
          code: "SESSION_NOT_FRESH",
        })
      )
    ).toMatchObject({ reason: "forbidden", code: "SESSION_NOT_FRESH" });
  });
});

describe("viewErrorOf", () => {
  test("maps the failure a cause carries", () => {
    expect(viewErrorOf(Cause.fail(new CustomerRateLimited()))._tag).toBe(
      "RateLimited"
    );
  });

  test("treats a defect or an interruption as unexpected", () => {
    expect(viewErrorOf(Cause.die(new Error("boom")))._tag).toBe("Unexpected");
    expect(viewErrorOf(Cause.interrupt())._tag).toBe("Unexpected");
  });
});

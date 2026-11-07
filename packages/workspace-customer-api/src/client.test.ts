import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Result } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  customerApiClientHeader,
  makeCustomerAuthApiClient,
  makeWorkspaceCustomerApiClient,
} from "./client";
import {
  CustomerAccountLinkRequired,
  type CustomerAccountState,
} from "./customer-account-api";
import { CustomerAuthRejected } from "./customer-auth-api";
import {
  CustomerInvoiceNotIssued,
  CustomerReservationOrderId,
} from "./customer-reservations-api";
import { CustomerSessionRequired } from "./customer-session";

const baseUrl = "https://workspace.deskohub.test";
const customerEmail = testEmailAddress("customer");

/**
 * An HttpClient that records each request as a web Request and answers it
 * with `respond`.
 */
const recordingClient = (respond: (request: Request) => Response) => {
  const requests: Request[] = [];
  const client = HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.map((webRequest) => {
        requests.push(webRequest);
        return HttpClientResponse.fromWeb(request, respond(webRequest));
      }),
      Effect.orDie
    )
  );
  return { client, requests };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.result,
      Effect.provideService(HttpClient.HttpClient, client)
    )
  );

const deletionPending: CustomerAccountState = {
  kind: "deletion-pending",
  email: customerEmail,
  deletion: "pending",
};

describe("makeWorkspaceCustomerApiClient", () => {
  test("sends the client header to the customer API path and decodes the account", async () => {
    const { client, requests } = recordingClient(() => json(deletionPending));

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.getAccount({ headers: {} })
      ),
      client
    );

    expect(result).toEqual(Result.succeed(deletionPending));
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/account`,
    ]);
    expect(requests[0]?.headers.get(customerApiClientHeader.name)).toBe(
      customerApiClientHeader.value
    );
  });

  test("keeps the client header when the caller's transform overwrites it", async () => {
    const { client, requests } = recordingClient(() => json(deletionPending));

    await run(
      Effect.flatMap(
        makeWorkspaceCustomerApiClient({
          baseUrl,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader(customerApiClientHeader.name, "other")
          ),
        }),
        (api) => api.account.getAccount({ headers: {} })
      ),
      client
    );

    expect(requests[0]?.headers.get(customerApiClientHeader.name)).toBe(
      customerApiClientHeader.value
    );
  });

  test("decodes endpoint and middleware errors as their tagged errors", async () => {
    const linkRequired = recordingClient(() =>
      json(
        { _tag: "CustomerAccountLinkRequired", reason: "profile-missing" },
        409
      )
    );
    const signedOut = recordingClient(() =>
      json({ _tag: "CustomerSessionRequired" }, 401)
    );
    const update = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.account.updateProfile({ payload: { firstName: "Ada" } })
    );

    expect(await run(update, linkRequired.client)).toEqual(
      Result.fail(
        new CustomerAccountLinkRequired({ reason: "profile-missing" })
      )
    );
    expect(await run(update, signedOut.client)).toEqual(
      Result.fail(new CustomerSessionRequired({}))
    );
  });

  test("decodes an invoice PDF as its bytes, and an unissued invoice as its tagged error", async () => {
    const orderId = CustomerReservationOrderId.make(
      "019edbcf-5026-7ecc-821b-eda46998eaaa"
    );
    const pdf = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
    const { client, requests } = recordingClient(() =>
      requests.length === 1
        ? new Response(pdf, {
            headers: {
              "content-type": "application/pdf",
              "content-disposition":
                'attachment; filename="WS-FV-2026-000042.pdf"',
            },
          })
        : json({ _tag: "CustomerInvoiceNotIssued" }, 409)
    );
    const download = Effect.flatMap(
      makeWorkspaceCustomerApiClient({ baseUrl }),
      (api) => api.reservations.getReservationInvoice({ params: { orderId } })
    );

    expect(await run(download, client)).toEqual(Result.succeed(pdf));
    expect(await run(download, client)).toEqual(
      Result.fail(new CustomerInvoiceNotIssued())
    );
    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/api/customer/reservations/${orderId}/invoice`,
      `${baseUrl}/api/customer/reservations/${orderId}/invoice`,
    ]);
  });

  test("uploads the avatar as one multipart file part", async () => {
    const { client, requests } = recordingClient(() =>
      json({ url: "https://res.cloudinary.test/avatar.webp", version: 3 })
    );
    const payload = new FormData();
    payload.set(
      "file",
      new File([new Uint8Array([1, 2, 3])], "avatar.png", {
        type: "image/png",
      })
    );

    const result = await run(
      Effect.flatMap(makeWorkspaceCustomerApiClient({ baseUrl }), (api) =>
        api.account.uploadAvatar({ payload })
      ),
      client
    );

    expect(result).toEqual(
      Result.succeed({
        url: "https://res.cloudinary.test/avatar.webp",
        version: 3,
      })
    );
    const request = requests[0];
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(`${baseUrl}/api/customer/account/avatar`);
    expect(request?.headers.get("content-type")).toStartWith(
      "multipart/form-data"
    );
    const file = (await request?.formData())?.get("file");
    expect(file instanceof File ? [file.type, file.size] : file).toEqual([
      "image/png",
      3,
    ]);
  });
});

describe("makeCustomerAuthApiClient", () => {
  test("calls Better Auth's paths and accepts its empty consent deletion", async () => {
    const { client, requests } = recordingClient(
      () => new Response(null, { status: 200 })
    );

    const result = await run(
      Effect.flatMap(makeCustomerAuthApiClient({ baseUrl }), (auth) =>
        auth.auth.deleteConsent({ payload: { id: "consent-1" } })
      ),
      client
    );

    expect(Result.isSuccess(result)).toBe(true);
    expect(requests[0]?.url).toBe(`${baseUrl}/api/auth/oauth2/delete-consent`);
    expect(await requests[0]?.json()).toEqual({ id: "consent-1" });
  });

  test("decodes a signed-out session as null", async () => {
    const { client } = recordingClient(() => json(null));

    expect(
      await run(
        Effect.flatMap(makeCustomerAuthApiClient({ baseUrl }), (auth) =>
          auth.auth.getSession()
        ),
        client
      )
    ).toEqual(Result.succeed(null));
  });

  test("decodes Better Auth's refusals by status, keeping only the fixed code", async () => {
    const unauthorized = recordingClient(() =>
      json({ message: "Unauthorized", code: "UNAUTHORIZED" }, 401)
    );
    const missingConsent = recordingClient(() =>
      json({ error: "not_found", error_description: "no consent" }, 404)
    );
    const foreignConsent = recordingClient(
      () => new Response(null, { status: 401 })
    );
    const disconnect = Effect.flatMap(
      makeCustomerAuthApiClient({ baseUrl }),
      (auth) => auth.auth.deleteConsent({ payload: { id: "consent-1" } })
    );

    expect(await run(disconnect, unauthorized.client)).toEqual(
      Result.fail(
        new CustomerAuthRejected({
          reason: "unauthorized",
          code: "UNAUTHORIZED",
        })
      )
    );
    expect(await run(disconnect, missingConsent.client)).toEqual(
      Result.fail(
        new CustomerAuthRejected({ reason: "not-found", code: "not_found" })
      )
    );
    const throttled = recordingClient(() =>
      json({ message: "Too many requests. Please try again later." }, 429)
    );
    expect(await run(disconnect, throttled.client)).toEqual(
      Result.fail(new CustomerAuthRejected({ reason: "rate-limited" }))
    );
    expect(await run(disconnect, foreignConsent.client)).toEqual(
      Result.fail(new CustomerAuthRejected({ reason: "unauthorized" }))
    );
  });
});

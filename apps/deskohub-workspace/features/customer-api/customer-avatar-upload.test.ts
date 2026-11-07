import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  CustomerAvatarRejected,
  customerAvatarFileField,
  customerAvatarMaxUploadBytes,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Stream } from "effect";
import { Multipart } from "effect/unstable/http";
import {
  authenticatedAs,
  failureOf,
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import {
  CustomerAvatarProviderError,
  CustomerAvatarService,
} from "@/features/account/backend/customer-avatar.service";
import type { CustomerAvatarUpload } from "@/features/account/backend/customer-avatar-mutations";
import { CustomerAvatarRejectedError } from "@/features/account/backend/customer-avatar-normalization";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { CustomerAccountLayers } from "./customer-account-layers";
import {
  type CustomerApiCall,
  customerApiRequest,
  linkedAccountServices,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import { customerAvatarUploadHandler } from "./customer-avatar-upload";

const boundary = "avatar-test-boundary";
const encoder = new TextEncoder();

const uploadAvatar: CustomerApiCall = {
  method: "PUT",
  path: "/account/avatar",
  headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
};

/** The bytes of one multipart part's delimiter and headers. */
const partHead = (
  name: string,
  { filename, contentType }: { filename?: string; contentType?: string } = {
    filename: "avatar.png",
    contentType: "image/png",
  }
) =>
  encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${
      filename === undefined ? "" : `; filename="${filename}"`
    }\r\n${contentType === undefined ? "" : `Content-Type: ${contentType}\r\n`}\r\n`
  );
const partEnd = encoder.encode("\r\n");
const closing = encoder.encode(`--${boundary}--\r\n`);

const filePart = (name: string, content: Uint8Array) => [
  partHead(name),
  content,
  partEnd,
];

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const storedAvatar = { url: "https://media.test/avatar.webp", version: 4 };

/** The upload request with this multipart body. */
const avatarRequest = (body: BodyInit) => {
  const request = customerApiRequest(uploadAvatar);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
};

const bodyOf = (...chunks: Uint8Array[]) => new Blob(chunks);

/**
 * A server whose session's account is linked, with avatars released unless
 * `released` is false, and an avatar service that records each upload and
 * answers with `result`.
 */
const avatarServer = ({
  released = true,
  result = Effect.succeed(storedAvatar),
}: {
  readonly released?: boolean;
  readonly result?: Effect.Effect<
    typeof storedAvatar,
    CustomerAvatarRejectedError | CustomerAvatarProviderError
  >;
} = {}) => {
  const uploads: Array<{ accountId: string; input: CustomerAvatarUpload }> = [];
  const api = makeCustomerApiTestServer({
    services: {
      ...linkedAccountServices,
      avatar: Layer.mock(CustomerAvatarService, {
        upload: (accountId, input) =>
          Effect.suspend(() => {
            uploads.push({ accountId, input });
            return result;
          }),
      }),
    },
    releases: {
      avatarRelease: AccountAvatarReleaseGate.fromDecision(released),
    },
  });
  return { ...api, uploads };
};

const expectRejected = async (response: Response, reason: string) => {
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    _tag: "CustomerAvatarRejected",
    reason,
  });
};

describe("uploadAvatar", () => {
  testCustomerEndpointGuards(uploadAvatar);

  test("stores the file part as the account's avatar", async () => {
    const api = avatarServer();

    const response = await api.handle(
      avatarRequest(
        bodyOf(...filePart(customerAvatarFileField, pngBytes), closing)
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(storedAvatar);
    expect(api.uploads).toEqual([
      {
        accountId: testLinkedAccount.accountId,
        input: {
          bytes: pngBytes,
          declaredSize: pngBytes.length,
          declaredMediaType: "image/png",
        },
      },
    ]);
  });

  test("accepts a file of exactly the size limit", async () => {
    const api = avatarServer();

    const response = await api.handle(
      avatarRequest(
        bodyOf(
          ...filePart(
            customerAvatarFileField,
            new Uint8Array(customerAvatarMaxUploadBytes)
          ),
          closing
        )
      )
    );

    expect(response.status).toBe(200);
    expect(api.uploads[0]?.input.bytes.length).toBe(
      customerAvatarMaxUploadBytes
    );
  });

  test("says avatars aren't available while their release is closed", async () => {
    const api = avatarServer({ released: false });

    const response = await api.handle(
      avatarRequest(
        bodyOf(...filePart(customerAvatarFileField, pngBytes), closing)
      )
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerFeatureUnavailable",
      feature: "avatars",
    });
    expect(api.uploads).toEqual([]);
  });

  test("passes the avatar service's rejection on", async () => {
    const api = avatarServer({
      result: Effect.fail(
        new CustomerAvatarRejectedError({ reason: "undecodable-image" })
      ),
    });

    const response = await api.handle(
      avatarRequest(
        bodyOf(...filePart(customerAvatarFileField, pngBytes), closing)
      )
    );

    await expectRejected(response, "undecodable-image");
  });

  test("answers unavailable when the media provider fails", async () => {
    const api = avatarServer({
      result: Effect.fail(new CustomerAvatarProviderError({})),
    });

    const response = await api.handle(
      avatarRequest(
        bodyOf(...filePart(customerAvatarFileField, pngBytes), closing)
      )
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("rejects a body without a file part as file-missing", async () => {
    const api = avatarServer();

    const response = await api.handle(avatarRequest(bodyOf(closing)));

    await expectRejected(response, "file-missing");
    expect(api.uploads).toEqual([]);
  });

  test.each([
    ["a file under another name", filePart("avatar", pngBytes)],
    [
      "a text field named file",
      [
        partHead(customerAvatarFileField, {}),
        encoder.encode("not a file"),
        partEnd,
      ],
    ],
  ])("rejects %s as file-missing", async (_, part) => {
    const api = avatarServer();

    const response = await api.handle(avatarRequest(bodyOf(...part, closing)));

    await expectRejected(response, "file-missing");
    expect(api.uploads).toEqual([]);
  });

  test("rejects a second part as file-missing", async () => {
    const api = avatarServer();

    const response = await api.handle(
      avatarRequest(
        bodyOf(
          ...filePart(customerAvatarFileField, pngBytes),
          ...filePart(customerAvatarFileField, pngBytes),
          closing
        )
      )
    );

    await expectRejected(response, "file-missing");
    expect(api.uploads).toEqual([]);
  });

  test.each([
    [
      "a body cut off inside the file",
      bodyOf(partHead(customerAvatarFileField), pngBytes),
    ],
    [
      "a body that ends before its closing delimiter",
      bodyOf(...filePart(customerAvatarFileField, pngBytes)),
    ],
    ["a body without any delimiter", bodyOf(pngBytes)],
  ])("rejects %s as file-missing", async (_, body) => {
    const api = avatarServer();

    const response = await api.handle(avatarRequest(body));

    await expectRejected(response, "file-missing");
    expect(api.uploads).toEqual([]);
  });

  test("rejects a file past the size limit as file-too-large", async () => {
    const api = avatarServer();

    const response = await api.handle(
      avatarRequest(
        bodyOf(
          ...filePart(
            customerAvatarFileField,
            new Uint8Array(customerAvatarMaxUploadBytes + 1)
          ),
          closing
        )
      )
    );

    await expectRejected(response, "file-too-large");
    expect(api.uploads).toEqual([]);
  });

  // Bun never settles `cancel()` on a streamed body re-wrapped by
  // `new Request(request, …)`, as the served handler re-wraps mutations, so
  // the early stop is observed on the part stream the endpoint receives.
  test("stops reading an endless file soon after the size limit", async () => {
    const chunkSize = 64 * 1024;
    const read = { bytes: 0 };
    const endlessFile = Stream.concat(
      Stream.make(partHead(customerAvatarFileField)),
      Stream.fromEffectRepeat(
        Effect.sync(() => {
          read.bytes += chunkSize;
          return new Uint8Array(chunkSize);
        })
      )
    );
    const payload = endlessFile.pipe(
      Stream.pipeThroughChannel(
        Multipart.makeChannel({
          "content-type": `multipart/form-data; boundary=${boundary}`,
        })
      ),
      // The contract's limits, which the served endpoint applies.
      Stream.provideContext(
        Multipart.limitsServices({
          maxParts: 1,
          maxFileSize: customerAvatarMaxUploadBytes,
          maxFieldSize: 1024,
          maxTotalSize: customerAvatarMaxUploadBytes + 64 * 1024,
        })
      )
    );
    const uploads: CustomerAvatarUpload[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.flatMap(customerAvatarUploadHandler, (upload) =>
        upload({ payload })
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            authenticatedAs(testCustomerSession),
            Layer.succeed(CustomerAccountLayers, {
              services: {
                ...linkedAccountServices,
                avatar: Layer.mock(CustomerAvatarService, {
                  upload: (_, input) =>
                    Effect.sync(() => {
                      uploads.push(input);
                      return storedAvatar;
                    }),
                }),
              },
              releases: {
                referralRelease: ReferralReleaseGate.fromDecision(false),
                passkeyRelease: PasskeyReleaseGate.fromDecision(false),
                avatarRelease: AccountAvatarReleaseGate.fromDecision(true),
              },
            })
          )
        )
      )
    );

    expect(failureOf(exit)).toEqual(
      new CustomerAvatarRejected({ reason: "file-too-large" })
    );
    expect(read.bytes).toBeLessThanOrEqual(
      customerAvatarMaxUploadBytes + chunkSize
    );
    expect(uploads).toEqual([]);
  });
});

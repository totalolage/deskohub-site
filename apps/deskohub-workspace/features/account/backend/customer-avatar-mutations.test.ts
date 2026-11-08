import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { CustomerAccountAccessError } from "../customer-account";
import { AccountFeatureWithheldError } from "./account-feature-withheld";
import {
  authenticatedAs,
  failureOf,
  resolvingTo,
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { AccountAvatarReleaseGate } from "./account-release-gates";
import {
  CustomerAvatarProviderError,
  CustomerAvatarService,
  CustomerAvatarUnavailableError,
} from "./customer-avatar.service";
import {
  type CustomerAvatarUpload,
  removeCurrentCustomerAvatar,
  uploadCurrentCustomerAvatar,
} from "./customer-avatar-mutations";
import { CustomerAvatarRejectedError } from "./customer-avatar-normalization";

const upload: CustomerAvatarUpload = {
  bytes: new Uint8Array([1, 2, 3]),
  declaredSize: 3,
  declaredMediaType: "image/png",
};
const storedAvatar = { url: "https://media.test/avatar.webp", version: 2 };

type RunOptions = {
  readonly signedIn?: boolean;
  readonly avatarsReleased?: boolean;
  readonly uploadResult?: Effect.Effect<
    typeof storedAvatar,
    | CustomerAvatarRejectedError
    | CustomerAvatarProviderError
    | CustomerAvatarUnavailableError
  >;
  readonly removeResult?: Effect.Effect<
    void,
    CustomerAvatarProviderError | CustomerAvatarUnavailableError
  >;
};

type Records = {
  readonly resolutions: { count: number };
  readonly media: Array<{
    readonly kind: "upload" | "remove";
    readonly accountId: string;
    readonly input?: CustomerAvatarUpload;
  }>;
};

/**
 * Fakes for the session, the avatar release decision, the resolver and the
 * media service; they record every resolution and media call.
 */
const fakes = (options: RunOptions, records: Records) =>
  Layer.mergeAll(
    authenticatedAs(options.signedIn === false ? null : testCustomerSession),
    AccountAvatarReleaseGate.fromDecision(options.avatarsReleased ?? true),
    resolvingTo(Effect.succeed(testLinkedAccount), records.resolutions),
    Layer.mock(CustomerAvatarService, {
      upload: (accountId, input) =>
        Effect.suspend(() => {
          records.media.push({ kind: "upload", accountId, input });
          return options.uploadResult ?? Effect.succeed(storedAvatar);
        }),
      remove: (accountId) =>
        Effect.suspend(() => {
          records.media.push({ kind: "remove", accountId });
          return options.removeResult ?? Effect.void;
        }),
    })
  );

const run = async <A, E>(
  mutation: Effect.Effect<A, E, Layer.Success<ReturnType<typeof fakes>>>,
  options: RunOptions = {}
) => {
  const records: Records = { resolutions: { count: 0 }, media: [] };
  const exit = await Effect.runPromiseExit(
    mutation.pipe(Effect.provide(fakes(options, records)))
  );
  return { exit, ...records };
};

describe("uploadCurrentCustomerAvatar", () => {
  test("stores the upload for the resolved session account", async () => {
    const { exit, media } = await run(uploadCurrentCustomerAvatar(upload));

    expect(exit).toEqual(
      Exit.succeed({ status: "uploaded", avatar: storedAvatar })
    );
    expect(media).toEqual([
      { kind: "upload", accountId: testLinkedAccount.accountId, input: upload },
    ]);
  });

  test("reports a typed rejection as its reason", async () => {
    const { exit } = await run(uploadCurrentCustomerAvatar(upload), {
      uploadResult: Effect.fail(
        new CustomerAvatarRejectedError({ reason: "file-too-large" })
      ),
    });

    expect(exit).toEqual(
      Exit.succeed({ status: "rejected", reason: "file-too-large" })
    );
  });

  test("reports a provider failure as retryable", async () => {
    const { exit } = await run(uploadCurrentCustomerAvatar(upload), {
      uploadResult: Effect.fail(new CustomerAvatarProviderError({})),
    });

    expect(exit).toEqual(Exit.succeed({ status: "retryable" }));
  });

  test("fails an unavailable media namespace", async () => {
    const { exit } = await run(uploadCurrentCustomerAvatar(upload), {
      uploadResult: Effect.fail(new CustomerAvatarUnavailableError({})),
    });

    expect(failureOf(exit)).toEqual(new CustomerAvatarUnavailableError({}));
  });

  test("fails unauthenticated before resolution or media work", async () => {
    const { exit, resolutions, media } = await run(
      uploadCurrentCustomerAvatar(upload),
      { signedIn: false }
    );

    expect(failureOf(exit)).toEqual(
      new CustomerAccountAccessError({ reason: "unauthenticated" })
    );
    expect(resolutions.count).toBe(0);
    expect(media).toEqual([]);
  });

  test("refuses while avatars are withheld, before resolution or media work", async () => {
    const { exit, resolutions, media } = await run(
      uploadCurrentCustomerAvatar(upload),
      { avatarsReleased: false }
    );

    expect(failureOf(exit)).toEqual(
      new AccountFeatureWithheldError({ feature: "avatars" })
    );
    expect(resolutions.count).toBe(0);
    expect(media).toEqual([]);
  });
});

describe("removeCurrentCustomerAvatar", () => {
  test("removes the avatar of the resolved session account", async () => {
    const { exit, media } = await run(removeCurrentCustomerAvatar());

    expect(exit).toEqual(Exit.succeed({ status: "removed" }));
    expect(media).toEqual([
      { kind: "remove", accountId: testLinkedAccount.accountId },
    ]);
  });

  test("reports an uncertain removal as retryable", async () => {
    const { exit } = await run(removeCurrentCustomerAvatar(), {
      removeResult: Effect.fail(new CustomerAvatarProviderError({})),
    });

    expect(exit).toEqual(Exit.succeed({ status: "retryable" }));
  });

  test("refuses while avatars are withheld, before resolution or media work", async () => {
    const { exit, resolutions, media } = await run(
      removeCurrentCustomerAvatar(),
      { avatarsReleased: false }
    );

    expect(failureOf(exit)).toEqual(
      new AccountFeatureWithheldError({ feature: "avatars" })
    );
    expect(resolutions.count).toBe(0);
    expect(media).toEqual([]);
  });
});

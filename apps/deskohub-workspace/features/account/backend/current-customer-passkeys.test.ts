import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { customerAccountUnavailable } from "../customer-account";
import type { AccountPasskey } from "../passkeys";
import { AccountFeatureWithheldError } from "./account-feature-withheld";
import { failureOf } from "./account-operations.test-utils";
import { PasskeyReleaseGate } from "./account-release-gates";
import { CustomerPasskeys } from "./auth/customer-passkeys.service";
import { listCurrentCustomerPasskeys } from "./current-customer-passkeys";

const passkey: AccountPasskey = {
  id: "passkey-1",
  name: "Laptop",
  provider: undefined,
  createdAt: "2026-11-01T08:00:00.000Z",
};

/**
 * Lists under the passkey release decision against a Better Auth list
 * answering `list`; counts every list read.
 */
const run = async (options: {
  readonly passkeysReleased: boolean;
  readonly list?: CustomerPasskeys["Service"]["list"];
}) => {
  const reads = { count: 0 };
  const exit = await Effect.runPromiseExit(
    listCurrentCustomerPasskeys.pipe(
      Effect.provide(
        Layer.mergeAll(
          PasskeyReleaseGate.fromDecision(options.passkeysReleased),
          Layer.mock(CustomerPasskeys, {
            list: Effect.suspend(() => {
              reads.count += 1;
              return options.list ?? Effect.succeed([passkey]);
            }),
          })
        )
      )
    )
  );
  return { exit, reads };
};

describe("listCurrentCustomerPasskeys", () => {
  test("lists the session account's passkeys while passkeys are released", async () => {
    const { exit } = await run({ passkeysReleased: true });

    expect(exit).toEqual(Exit.succeed([passkey]));
  });

  test("refuses before reading the list while passkeys are withheld", async () => {
    const { exit, reads } = await run({ passkeysReleased: false });

    expect(failureOf(exit)).toEqual(
      new AccountFeatureWithheldError({ feature: "passkeys" })
    );
    expect(reads.count).toBe(0);
  });

  test("passes an unavailable list through", async () => {
    const failure = customerAccountUnavailable("authentication.passkeys");
    const { exit } = await run({
      passkeysReleased: true,
      list: Effect.fail(failure),
    });

    expect(failureOf(exit)).toBe(failure);
  });
});

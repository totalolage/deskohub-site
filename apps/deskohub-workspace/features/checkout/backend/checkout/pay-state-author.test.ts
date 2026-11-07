import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { requirePayStateAuthor } from "./pay-state-author";
import {
  sealSyntheticPayStateToken,
  syntheticPayStateOrderId,
} from "./signed-pay-state.test-utils";

const author = "author-account" as CustomerAccountId;
const otherAccount = "other-account" as CustomerAccountId;

const runCheck = async (input: {
  readonly accountId: CustomerAccountId;
  readonly findById: WorkspaceReservationRepository["Service"]["findById"];
  readonly locale?: "en-US" | "cs-CZ";
  readonly payStateToken?: string;
}) => {
  const payStateToken =
    input.payStateToken ?? (await sealSyntheticPayStateToken());
  return await Effect.runPromise(
    requirePayStateAuthor({
      payStateToken,
      locale: input.locale ?? "en-US",
      accountId: input.accountId,
    }).pipe(
      Effect.result,
      Effect.provide(
        Layer.mergeAll(
          TestSealedStateKeys,
          Layer.mock(WorkspaceReservationRepository, {
            findById: input.findById,
          })
        )
      )
    )
  );
};

const storedOrder = (authorAccountId: CustomerAccountId) =>
  mock(() =>
    Effect.succeed({
      id: syntheticPayStateOrderId,
      authorAccountId,
    } as WorkspaceReservation)
  );

describe("requirePayStateAuthor", () => {
  test("returns the opened Pay state to the account that authored its order", async () => {
    const findById = storedOrder(author);

    const result = await runCheck({ accountId: author, findById });

    expect(findById).toHaveBeenCalledWith(syntheticPayStateOrderId);
    expect(result).toMatchObject({
      _tag: "Success",
      success: { orderId: syntheticPayStateOrderId, locale: "en-US" },
    });
  });

  test("hides another account's order as not found", async () => {
    const result = await runCheck({
      accountId: otherAccount,
      findById: storedOrder(author),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "PayStateAuthorNotFoundError",
        orderId: syntheticPayStateOrderId,
      },
    });
  });

  test("answers a missing order as not found", async () => {
    const result = await runCheck({
      accountId: author,
      findById: mock(() => Effect.succeed(null)),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PayStateAuthorNotFoundError" },
    });
  });

  test("keeps a repository failure distinct from not found", async () => {
    const result = await runCheck({
      accountId: author,
      findById: mock(() =>
        Effect.fail(
          new EffectDrizzleQueryError({
            query: "select",
            params: [],
            cause: Cause.die(new Error("connection reset")),
          })
        )
      ),
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "EffectDrizzleQueryError" },
    });
  });

  test("rejects a Pay state signed for another language before loading the order", async () => {
    const findById = storedOrder(author);
    const payStateToken = await sealSyntheticPayStateToken({
      locale: "cs-CZ",
    });

    const result = await runCheck({
      accountId: author,
      findById,
      payStateToken,
    });

    expect(findById).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PayStateTokenError", code: "invalid-token" },
    });
  });
});

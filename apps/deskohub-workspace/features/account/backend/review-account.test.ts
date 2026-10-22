import "@/shared/polyfills/temporal";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import { ReviewSandboxMock } from "@/features/review-accounts/backend/review-sandbox.service.mock";
import type { CustomerReservationHistory } from "../contracts";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountResolutionDependencies,
  resolveCustomerAccountLink,
} from "./customer-account-resolver.service";
import { CustomerAuthentication } from "./customer-authentication.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";
import { CustomerProfileService } from "./customer-profile.service";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";
import { ReservationAuthorDirectory } from "./reservation-author-directory.service";

const accountId = customerAccountIdSchema.make("review-account");
const email = reservationCustomerEmailSchema.make(testEmailAddress("reviewer"));

const reviewAccounts = (review: boolean) =>
  ReviewAccountsMock({ isReviewAccount: () => Effect.succeed(review) });

const activeLinks = Layer.mock(CustomerAccountLinkRepository, {
  find: () => Effect.succeed(null),
  findActivityState: () =>
    Effect.succeed({ kind: "active", deletionRequestedAt: null } as const),
  withAccountLock: (_accountId, effect) => effect,
});

// Every Dotypos customer call dies, so reaching Dotypos fails the test.
const unreachableDotypos = Layer.mock(CustomerDotyposAdapter, {});

const expectReviewRefusal = (
  outcome: Result.Result<unknown, CustomerAccountAccessError>
) => {
  expect(Result.isFailure(outcome)).toBe(true);
  if (Result.isSuccess(outcome)) return;
  expect(outcome.failure.reason).toBe("unavailable");
  expect(outcome.failure.cause?.code).toBe("account.review");
};

describe("a review account's Dotypos link", () => {
  test("is never resolved, and resolution never looks the email up", async () => {
    const calls: string[] = [];
    const dependencies: CustomerAccountResolutionDependencies = {
      currentUser: () =>
        Effect.succeed({ accountId, email, deletionRequested: false }),
      findLink: () => Effect.succeed(null),
      isReviewAccount: () => Effect.succeed(true),
      classify: () => {
        calls.push("classify");
        return Effect.succeed({ kind: "not-found" } as const);
      },
      claimLink: () => Effect.die("claim must not be called"),
      reactivate: () => Effect.die("reactivate must not be called"),
      withAccountLock: (_accountId, effect) => effect,
    };

    const outcome = await resolveCustomerAccountLink(dependencies).pipe(
      Effect.result,
      Effect.runPromise
    );

    expectReviewRefusal(outcome);
    expect(calls).toEqual([]);
  });

  test("is never created by completing a profile", async () => {
    const outcome = await CustomerProfileService.pipe(
      Effect.flatMap((profiles) =>
        profiles.createUnderHeldLock(accountId, email, {
          firstName: "App",
          lastName: "Review",
          phone: "+44 20 7946 0123",
          billing: null,
        } as never)
      ),
      Effect.provide(
        CustomerProfileService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              activeLinks,
              unreachableDotypos,
              reviewAccounts(true)
            )
          )
        )
      ),
      Effect.result,
      Effect.runPromise
    );

    expectReviewRefusal(outcome);
  });
});

describe("a review account's booking contact", () => {
  const current = (review: boolean) =>
    CustomerAccountContactService.pipe(
      Effect.flatMap((contacts) => contacts.current),
      Effect.provide(
        CustomerAccountContactService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(CustomerAuthentication, {
                currentUser: Effect.succeed({
                  accountId,
                  email,
                  deletionRequested: false,
                }),
              } as never),
              activeLinks,
              Layer.mock(CustomerProfileService, {}),
              reviewAccounts(review)
            )
          )
        )
      ),
      Effect.runPromise
    );

  test("is synthetic, on the account's own login email", async () => {
    const contact = await current(true);

    expect(contact).toMatchObject({ accountId, email });
    expect(contact?.name).toBeTruthy();
    expect(contact?.phone).toBeTruthy();
  });

  test("stays absent for an ordinary account without a profile", async () => {
    expect(await current(false)).toBeNull();
  });
});

describe("a review account's reservation history", () => {
  test("comes from its sandbox without reading the reservation ledger or Dotypos", async () => {
    const sandboxHistory: CustomerReservationHistory = {
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    };
    const history = mock(() => Effect.succeed(sandboxHistory));

    const loaded = await CustomerReservationHistoryService.pipe(
      Effect.flatMap((service) => service.load({ accountId })),
      Effect.provide(
        CustomerReservationHistoryService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              // A database query would throw on this client.
              Layer.succeed(WorkspaceDatabase, { db: {} } as never),
              Layer.mock(DotyposService, {}),
              Layer.mock(ReservationRecords, {}),
              activeLinks,
              Layer.mock(ReservationAuthorDirectory, {}),
              reviewAccounts(true),
              ReviewSandboxMock({ history })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(loaded).toBe(sandboxHistory);
    expect(history).toHaveBeenCalledWith(accountId);
  });
});

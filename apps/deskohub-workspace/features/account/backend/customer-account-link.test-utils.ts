import { Effect, Layer } from "effect";
import type { UnreachableWorkspaceDatabase } from "@/shared/testing/unreachable-workspace-database.test-utils";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

type AccountLinks = CustomerAccountLinkRepository["Service"];

/**
 * The real account link repository over a database it can't reach. It is
 * built on its own, because a layer graph would share one memoized
 * `CustomerAccountLinkRepository.Default` with the healthy repository.
 */
export const unreachableAccountLinks = (
  unreachable: UnreachableWorkspaceDatabase
): Promise<AccountLinks> =>
  Effect.runPromise(
    Effect.service(CustomerAccountLinkRepository).pipe(
      Effect.provide(
        CustomerAccountLinkRepository.Default.pipe(
          Layer.provide(
            Layer.mergeAll(unreachable.database, unreachable.advisoryLock)
          )
        )
      )
    )
  );

/**
 * The healthy account link repository with the named reads served by the
 * unreachable one, so each fails with a real connection error while the
 * others answer.
 */
export const accountLinksFailingAt = (
  reads: readonly ("find" | "findActivityState" | "withAccountLock")[],
  repositories: {
    readonly healthy: Layer.Layer<CustomerAccountLinkRepository>;
    readonly unreachable: AccountLinks;
  }
) =>
  Layer.effect(
    CustomerAccountLinkRepository,
    Effect.map(
      CustomerAccountLinkRepository,
      (healthy): AccountLinks => ({
        ...healthy,
        ...(reads.includes("find") && {
          find: repositories.unreachable.find,
        }),
        ...(reads.includes("findActivityState") && {
          findActivityState: repositories.unreachable.findActivityState,
        }),
        ...(reads.includes("withAccountLock") && {
          withAccountLock: repositories.unreachable.withAccountLock,
        }),
      })
    )
  ).pipe(Layer.provide(repositories.healthy));

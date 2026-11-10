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
          Layer.provide(unreachable.database)
        )
      )
    )
  );

/**
 * The healthy account link repository with the named reads served by the
 * unreachable one, so each fails with a real connection error while the
 * others answer. With `afterHealthyReads`, each named read first answers that
 * many times, so a later read of the same fact fails.
 */
export const accountLinksFailingAt = (
  reads: readonly ("find" | "findActivityState")[],
  repositories: {
    readonly healthy: Layer.Layer<CustomerAccountLinkRepository>;
    readonly unreachable: AccountLinks;
    readonly afterHealthyReads?: number;
  }
) =>
  Layer.effect(
    CustomerAccountLinkRepository,
    Effect.map(CustomerAccountLinkRepository, (healthy): AccountLinks => {
      const { unreachable } = repositories;
      const healthyReads = repositories.afterHealthyReads ?? 0;
      const calls = { find: 0, findActivityState: 0 };
      const fails = (read: (typeof reads)[number]) =>
        reads.includes(read) && calls[read]++ >= healthyReads;
      return {
        ...healthy,
        find: (accountId) =>
          (fails("find") ? unreachable : healthy).find(accountId),
        findActivityState: (accountId) =>
          (fails("findActivityState")
            ? unreachable
            : healthy
          ).findActivityState(accountId),
      };
    })
  ).pipe(Layer.provide(repositories.healthy));

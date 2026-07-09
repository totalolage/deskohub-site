import { Context, Deferred, Effect, Layer, Ref, Semaphore } from "effect";
import type { WorkspaceE2EResourceScope } from "../types";

interface IWorkspaceE2EResourceService extends WorkspaceE2EResourceScope {}

export class WorkspaceE2EResourceService extends Context.Service<
  WorkspaceE2EResourceService,
  IWorkspaceE2EResourceService
>()("WorkspaceE2EResourceService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const checkoutProviderSession = yield* Semaphore.make(1);
      const checkoutFlowProviderSessionsRemaining = yield* Ref.make(0);
      const paymentTerminalProviderSessionsOpen = yield* Deferred.make<void>();
      const openPaymentTerminalProviderSessions = Deferred.succeed(
        paymentTerminalProviderSessionsOpen,
        undefined
      ).pipe(Effect.asVoid);

      return {
        expectCheckoutFlowProviderSessions: (count) =>
          Ref.set(checkoutFlowProviderSessionsRemaining, count).pipe(
            Effect.andThen(
              count === 0 ? openPaymentTerminalProviderSessions : Effect.void
            )
          ),
        withCheckoutFlowProviderSession: (effect) =>
          checkoutProviderSession
            .withPermit(effect)
            .pipe(
              Effect.ensuring(
                Ref.updateAndGet(
                  checkoutFlowProviderSessionsRemaining,
                  (remaining) => Math.max(0, remaining - 1)
                ).pipe(
                  Effect.andThen((remaining) =>
                    remaining === 0
                      ? openPaymentTerminalProviderSessions
                      : Effect.void
                  )
                )
              )
            ),
        withPaymentTerminalProviderSession: (effect) =>
          Deferred.await(paymentTerminalProviderSessionsOpen).pipe(
            Effect.andThen(checkoutProviderSession.withPermit(effect))
          ),
      } satisfies IWorkspaceE2EResourceService;
    })
  );
}

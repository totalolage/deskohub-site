import { Context, Effect, Layer, Semaphore } from "effect";
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

      return {
        withCheckoutProviderSession: (effect) =>
          checkoutProviderSession.withPermit(effect),
      } satisfies IWorkspaceE2EResourceService;
    })
  );
}

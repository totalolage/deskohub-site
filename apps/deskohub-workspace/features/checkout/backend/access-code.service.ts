import { Context, Effect, Layer } from "effect";

export const workspaceCheckoutPlaceholderAccessCode = "451936";

export interface WorkspaceCheckoutAccessCodeService {
  readonly generateCustomerAccessCode: () => Effect.Effect<string>;
}

export const WorkspaceCheckoutAccessCodeService =
  Context.Service<WorkspaceCheckoutAccessCodeService>(
    "WorkspaceCheckoutAccessCodeService"
  );

export const generateWorkspaceCustomerAccessCode: () => Effect.Effect<string> =
  Effect.fn("workspaceCheckoutAccessCode.generateCustomerAccessCode")(
    function* () {
      return yield* Effect.succeed(workspaceCheckoutPlaceholderAccessCode);
    }
  );

export const WorkspaceCheckoutAccessCodeServiceLive = Layer.succeed(
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeService.of({
    generateCustomerAccessCode: generateWorkspaceCustomerAccessCode,
  })
);

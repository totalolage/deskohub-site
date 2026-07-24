import { Context, Effect, Layer } from "effect";

const workspaceCheckoutPlaceholderAccessCode = "7915";

export interface WorkspaceCheckoutAccessCodeService {
  readonly generateCustomerAccessCode: Effect.Effect<string>;
}

export const WorkspaceCheckoutAccessCodeService =
  Context.Service<WorkspaceCheckoutAccessCodeService>(
    "WorkspaceCheckoutAccessCodeService"
  );

export const generateWorkspaceCustomerAccessCode = Effect.succeed(
  workspaceCheckoutPlaceholderAccessCode
);

export const WorkspaceCheckoutAccessCodeServiceLive = Layer.succeed(
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeService.of({
    generateCustomerAccessCode: generateWorkspaceCustomerAccessCode,
  })
);

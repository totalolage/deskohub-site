import { Context, Effect, Layer } from "effect";

export const workspaceCheckoutPlaceholderAccessCode = "451936";

export interface ResolveWorkspaceCustomerAccessCodeInput {
  readonly orderId: string;
  readonly dotyposReservationId: string;
}

export interface WorkspaceCheckoutAccessCodeService {
  readonly resolveCustomerAccessCode: (
    input: ResolveWorkspaceCustomerAccessCodeInput
  ) => Effect.Effect<string>;
}

export const WorkspaceCheckoutAccessCodeService =
  Context.GenericTag<WorkspaceCheckoutAccessCodeService>(
    "WorkspaceCheckoutAccessCodeService"
  );

export const resolveWorkspaceCustomerAccessCode: (
  input: ResolveWorkspaceCustomerAccessCodeInput
) => Effect.Effect<string> = Effect.fn(
  "workspaceCheckoutAccessCode.resolveCustomerAccessCode"
)(
  function* (_input) {
    return yield* Effect.succeed(workspaceCheckoutPlaceholderAccessCode);
  },
  (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
);

export const WorkspaceCheckoutAccessCodeServiceLive = Layer.succeed(
  WorkspaceCheckoutAccessCodeService,
  WorkspaceCheckoutAccessCodeService.of({
    resolveCustomerAccessCode: resolveWorkspaceCustomerAccessCode,
  })
);

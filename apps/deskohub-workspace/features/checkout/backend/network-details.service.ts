import { Context, Effect, Layer } from "effect";

export interface WorkspaceCheckoutNetworkDetails {
  readonly ssid: string;
  readonly password: string;
}

const escapeWifiQrValue = (value: string) =>
  value.replaceAll(/([\\;,:])/g, "\\$1");

export const createWorkspaceCheckoutWifiQrPayload = (
  details: WorkspaceCheckoutNetworkDetails
) =>
  `WIFI:T:WPA;S:${escapeWifiQrValue(details.ssid)};P:${escapeWifiQrValue(details.password)};;`;

export const workspaceCheckoutPlaceholderNetworkDetails: WorkspaceCheckoutNetworkDetails =
  {
    ssid: "Deskohub Workspace",
    password: "Workspace42",
  };

export interface IWorkspaceCheckoutNetworkDetailsService {
  readonly resolveCustomerNetworkDetails: (input: {
    readonly reservation: { readonly id: string };
  }) => Effect.Effect<WorkspaceCheckoutNetworkDetails>;
}

export class WorkspaceCheckoutNetworkDetailsService extends Context.Service<
  WorkspaceCheckoutNetworkDetailsService,
  IWorkspaceCheckoutNetworkDetailsService
>()("@deskohub-workspace/checkout/WorkspaceCheckoutNetworkDetailsService") {
  static Live = Layer.succeed(this, {
    resolveCustomerNetworkDetails: Effect.fn(
      "workspaceCheckoutNetworkDetails.resolveCustomerNetworkDetails"
    )(function* () {
      return yield* Effect.succeed(workspaceCheckoutPlaceholderNetworkDetails);
    }),
  });
}

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
    ssid: "O2-Internet_6BE",
    password: "95502205",
  };

export interface IWorkspaceCheckoutNetworkDetailsService {
  readonly resolveCustomerNetworkDetails: (input: {
    readonly reservation: { readonly id: string };
  }) => Effect.Effect<WorkspaceCheckoutNetworkDetails>;
}

export class WorkspaceCheckoutNetworkDetailsService extends Context.Tag(
  "@deskohub-workspace/checkout/WorkspaceCheckoutNetworkDetailsService"
)<
  WorkspaceCheckoutNetworkDetailsService,
  IWorkspaceCheckoutNetworkDetailsService
>() {
  static Live = Layer.succeed(this, {
    resolveCustomerNetworkDetails: Effect.fn(
      "workspaceCheckoutNetworkDetails.resolveCustomerNetworkDetails"
    )(function* () {
      return yield* Effect.succeed(workspaceCheckoutPlaceholderNetworkDetails);
    }),
  });
}

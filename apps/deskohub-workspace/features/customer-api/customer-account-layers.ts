import { Context, Layer } from "effect";
import {
  type AccountReleaseLayers,
  type AccountServiceLayers,
  liveAccountServiceLayers,
  runAccountReleaseLayers,
} from "@/features/account/backend/account-state-capabilities";

interface ICustomerAccountLayers {
  /**
   * The account services' Layers. The request's authentication is the one
   * the session middleware read through, so it isn't here.
   */
  readonly services: Omit<AccountServiceLayers, "authentication">;
  /** The release gates, built once per request. */
  readonly releases: AccountReleaseLayers;
}

/**
 * The account Layers each customer API request builds its operation from.
 * An endpoint provides them per request, inside the request's Workspace
 * request context, so a release gate decides once per request and a Layer
 * that can't be built fails only the requests that use it, as unavailable.
 */
export class CustomerAccountLayers extends Context.Service<
  CustomerAccountLayers,
  ICustomerAccountLayers
>()("@deskohub-workspace/customer-api/CustomerAccountLayers") {
  static Live = Layer.succeed(this, {
    services: liveAccountServiceLayers,
    releases: runAccountReleaseLayers,
  });
}

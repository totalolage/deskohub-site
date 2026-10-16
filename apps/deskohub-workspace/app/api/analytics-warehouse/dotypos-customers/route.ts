import { Effect, Layer } from "effect";
import { respondWithDotyposCustomerSource } from "@/features/analytics-warehouse/backend/dotypos-customer-source";
import { DotyposCustomerSourceAccess } from "@/features/analytics-warehouse/backend/dotypos-customer-source-access.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * GET /api/analytics-warehouse/dotypos-customers
 *
 * PostHog's Custom REST warehouse source pulls allowlisted Dotypos customer
 * fields here. Production only; see the `deskohub-dotypos` skill for the
 * contract and the PostHog configuration.
 */
export const GET = defineWorkspaceRoute(
  {
    operation: "analyticsWarehouseDotyposCustomers",
    cancellation: "interrupt-on-disconnect",
  },
  (request: Request) =>
    respondWithDotyposCustomerSource(request).pipe(
      Effect.provide(
        Layer.mergeAll(
          DotyposCustomerSourceAccess.Default,
          RequestBudget.Live,
          WorkspaceDotyposLayer
        )
      ),
      // Layer failures can quote configuration values, so only the tag leaves.
      Effect.mapError(
        (error) =>
          new WorkspaceRouteFailure({
            statusCode: 503,
            publicMessage: "The Dotypos customer source is unavailable.",
            cause: { errorTag: error._tag },
          })
      )
    )
);

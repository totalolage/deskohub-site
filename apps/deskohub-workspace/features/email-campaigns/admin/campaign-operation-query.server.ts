import "server-only";

import type {
  CampaignOperationName,
  CampaignOperations as CampaignOperationRegistry,
  OperationInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { authorizeAdministratorPage } from "@/features/administrators/server/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CampaignOperations } from "../backend/campaign-operations.service";
import { OperationRequestLedger } from "../backend/operation-request-ledger.service";

/** One campaign operation through the port, inside a page load. */
export const invokeCampaignOperation = <Name extends CampaignOperationName>(
  name: Name,
  input: OperationInput<CampaignOperationRegistry[Name]>
) =>
  CampaignOperations.pipe(
    Effect.flatMap((operations) => operations.invoke(name, input))
  );

/**
 * Runs a page load's campaign queries as the administrator the page gate
 * authorized. The gate is cached per request, so loaders that run after the
 * page's own check don't read the session again.
 */
export const runCampaignPageQuery = async <A, E>(
  operation: string,
  query: Effect.Effect<
    A,
    E,
    CampaignOperations | CurrentAdministrator | OperationRequestLedger
  >
): Promise<A> => {
  const administrator = await authorizeAdministratorPage();
  return query.pipe(
    Effect.provide(
      Layer.mergeAll(
        CampaignOperations.Live,
        OperationRequestLedger.unscoped,
        Layer.succeed(CurrentAdministrator, administrator)
      )
    ),
    runWorkspaceEffect(operation, { boundary: "route" })
  );
};

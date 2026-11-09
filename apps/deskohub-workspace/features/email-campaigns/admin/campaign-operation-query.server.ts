import "server-only";

import type {
  CampaignOperationName,
  CampaignOperations as CampaignOperationRegistry,
  OperationInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { CampaignOperations } from "../backend/campaign-operations.service";
import { OperationRequestLedger } from "../backend/operation-request-ledger.service";

/**
 * What an admin page or action needs to run campaign operations as the
 * administrator it authorized.
 */
export const campaignOperationCapabilities = Layer.mergeAll(
  CampaignOperations.Live,
  OperationRequestLedger.unscoped
);

/** One campaign operation through the port, inside a page load. */
export const invokeCampaignOperation = <Name extends CampaignOperationName>(
  name: Name,
  input: OperationInput<CampaignOperationRegistry[Name]>
) =>
  CampaignOperations.pipe(
    Effect.flatMap((operations) => operations.invoke(name, input))
  );

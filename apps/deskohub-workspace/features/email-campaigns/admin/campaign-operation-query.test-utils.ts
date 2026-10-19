import { mock } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  CampaignOperationError,
  CampaignOperationName,
  CampaignOperations as CampaignOperationRegistry,
  OperationInput,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import type { ICampaignOperations } from "../backend/campaign-operations.service";

class StubCampaignOperations extends Context.Service<
  StubCampaignOperations,
  ICampaignOperations
>()("@test/CampaignOperations") {}

type Invocation = {
  readonly name: CampaignOperationName;
  readonly input: OperationInput<
    CampaignOperationRegistry[CampaignOperationName]
  >;
};

/**
 * Stubs the campaign operation port and the page gate for page-load tests.
 * Call it before importing the loader; set `responses` per operation name
 * and read the names the loader invoked, in order, from `invoked`.
 */
export const stubCampaignPageQueries = () => {
  const actor: AdministratorAccountActor = {
    accountId: customerAccountIdSchema.make("fixture-administrator"),
    email: testEmailAddress("campaign-page-actor"),
  };
  const port = {
    responses: {} as Partial<
      Record<
        CampaignOperationName,
        Effect.Effect<unknown, CampaignOperationError>
      >
    >,
    invoked: [] as Invocation[],
  };

  mock.module(
    "@/features/email-campaigns/backend/campaign-operations.service",
    () => ({
      CampaignOperations: Object.assign(StubCampaignOperations, {
        Live: Layer.succeed(
          StubCampaignOperations,
          StubCampaignOperations.of({
            invoke: ((name, input) => {
              port.invoked.push({ name, input });
              return port.responses[name] ?? Effect.die(`unexpected ${name}`);
            }) as ICampaignOperations["invoke"],
          })
        ),
      }),
    })
  );
  mock.module(
    "@/features/administrators/server/administrator-authorization.server",
    () => ({ authorizeAdministratorPage: async () => actor })
  );
  mock.module("@/instrumentation", () => ({
    postHogLoggerProvider: {
      forceFlush: () => Promise.resolve(),
      getLogger: () => ({ emit: () => undefined }),
    },
  }));

  return port;
};

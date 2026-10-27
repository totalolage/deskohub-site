import { mock } from "bun:test";
import type {
  CampaignOperationError,
  CampaignOperationName,
  CampaignOperations as CampaignOperationRegistry,
  OperationInput,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer } from "effect";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";
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
 * Stubs the campaign operation port and the session behind the page gate for
 * page-load tests. Call it before importing the loader; set `responses` per
 * operation name, read the names the loader invoked, in order, from
 * `invoked`, and set who the request acts as through `access`.
 */
export const stubCampaignPageQueries = () => {
  const access = mockAdministratorAccess("campaign-page-actor");
  const port = {
    access,
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
  mock.module("next/headers", () => ({
    cookies: async () => ({ get: () => undefined, getAll: () => [] }),
    headers: async () =>
      new Headers({ referer: "https://deskohub.test/en-US/admin" }),
  }));
  mock.module("next/server", () => ({
    after: () => undefined,
    connection: () => Promise.resolve(),
  }));
  mock.module("@/instrumentation", () => ({
    postHogLoggerProvider: {
      forceFlush: () => Promise.resolve(),
      getLogger: () => ({ emit: () => undefined }),
    },
  }));

  return port;
};

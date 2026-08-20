import { Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import type { AllocationOwner } from "./allocation";
import { AllocationRuntimeConfig } from "./config";

const WorkflowRun = Schema.Struct({ status: Schema.String });

interface IGithubRunStatusService {
  readonly isTerminal: (
    owner: AllocationOwner
  ) => Effect.Effect<boolean, never>;
}

export class GithubRunStatusService extends Context.Service<
  GithubRunStatusService,
  IGithubRunStatusService
>()("WorkspaceE2E/GithubRunStatusService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* AllocationRuntimeConfig;
      const httpClient = yield* HttpClient.HttpClient;
      const authenticatedClient = httpClient.pipe(
        HttpClient.mapRequestInput((request) =>
          request.pipe(
            HttpClientRequest.setHeaders({
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${Redacted.value(config.githubToken)}`,
              "X-GitHub-Api-Version": "2022-11-28",
            })
          )
        )
      );

      const isTerminal = Effect.fn("GithubRunStatusService.isTerminal")(
        function* (owner: AllocationOwner) {
          const response = yield* authenticatedClient.get(
            githubRunAttemptUrl(config.githubApiUrl, owner)
          );
          if (response.status === 404) return false;

          const run = yield* response.pipe(
            HttpClientResponse.filterStatusOk,
            Effect.flatMap(HttpClientResponse.schemaBodyJson(WorkflowRun))
          );
          return run.status === "completed";
        }
      );

      return {
        isTerminal: (owner) =>
          isTerminal(owner).pipe(Effect.orElseSucceed(() => false)),
      } satisfies IGithubRunStatusService;
    })
  );
}

export const githubRunAttemptUrl = (
  githubApiUrl: string,
  owner: AllocationOwner
) =>
  `${githubApiUrl}/repos/${owner.repository}/actions/runs/${owner.runId}/attempts/${owner.runAttempt}`;

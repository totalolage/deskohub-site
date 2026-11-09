import { expect, test } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { AllocationRuntimeConfig } from "./config";
import { GithubRunStatusService } from "./github-run-status.service";

const isTerminal = (response: Response) => {
  const requestedUrls: string[] = [];
  const fetchMock: typeof globalThis.fetch = Object.assign(
    (input: RequestInfo | URL) => {
      requestedUrls.push(new Request(input).url);
      return Promise.resolve(response);
    },
    { preconnect: globalThis.fetch.preconnect }
  );
  const layer = GithubRunStatusService.Default.pipe(
    Layer.provide(
      AllocationRuntimeConfig.layer({
        githubApiUrl: "https://api.github.test",
        githubToken: Redacted.make("synthetic-token"),
      })
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );

  return Effect.runPromise(
    GithubRunStatusService.use((service) =>
      service.isTerminal({
        repository: "totalolage/deskohub-site",
        runAttempt: 4,
        runId: 123,
      })
    ).pipe(Effect.provide(layer))
  ).then((terminal) => ({ requestedUrls, terminal }));
};

test("reconciles the exact workflow attempt instead of the latest run", async () => {
  const { requestedUrls, terminal } = await isTerminal(
    Response.json({ status: "completed" })
  );

  expect(requestedUrls).toEqual([
    "https://api.github.test/repos/totalolage/deskohub-site/actions/runs/123/attempts/4",
  ]);
  expect(terminal).toBe(true);
});

test.each([
  ["an in-progress attempt", Response.json({ status: "in_progress" })],
  ["a missing attempt", new Response(null, { status: 404 })],
  ["a failed status read", new Response(null, { status: 502 })],
])("keeps the allocation for %s", async (_label, response) => {
  const { terminal } = await isTerminal(response);

  expect(terminal).toBe(false);
});

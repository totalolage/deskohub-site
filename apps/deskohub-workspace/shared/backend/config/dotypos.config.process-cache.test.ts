import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";
import { WorkspaceDotyposLayer } from "./dotypos.config";

const resolveDotypos = () =>
  Effect.runPromise(
    Effect.service(DotyposService).pipe(Effect.provide(WorkspaceDotyposLayer))
  );

test("separate requests share one process-wide Dotypos adapter and its token cache", async () => {
  const first = await resolveDotypos();
  const second = await resolveDotypos();

  expect(second).toBe(first);
});

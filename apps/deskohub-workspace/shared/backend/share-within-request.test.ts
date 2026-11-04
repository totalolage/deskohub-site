import { expect, test } from "bun:test";
import { runReactServerFixture } from "@/shared/testing/react-server-fixture.test-utils";

test("shares evaluations within real React server renders", async () => {
  const { exitCode, output } = await runReactServerFixture(
    "./shared/backend/share-within-request.rsc-fixture.ts"
  );

  expect(exitCode).toBe(0);
  expect(output).toContain("6 pass");
  expect(output).toContain("SHARE_WITHIN_REQUEST_REACT_SERVER_PROOF");
});

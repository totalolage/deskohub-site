import { expect, test } from "bun:test";

test("generates the Effect client from the OpenAPI contract", async () => {
  const packageDirectory = new URL("..", import.meta.url);
  const generation = Bun.spawn(["bun", "run", "generate"], {
    cwd: packageDirectory.pathname,
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    generation.exited,
    new Response(generation.stderr).text(),
  ]);

  if (exitCode !== 0) throw new Error(stderr);
  expect(exitCode).toBe(0);
  expect(
    await Bun.file(
      new URL("src/generated/effect.gen.ts", packageDirectory)
    ).text()
  ).toContain('"500": decodeError');
});

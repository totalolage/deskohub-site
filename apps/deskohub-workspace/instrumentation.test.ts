import { expect, test } from "bun:test";

test("censors the actual global Vercel tracing export path", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push(await request.text());
      return new Response(null, { status: 200 });
    },
  });

  try {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "--preload",
        "./shared/testing/workspace-test-env.ts",
        "./shared/testing/global-tracing-fixture.ts",
      ],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
        SYNTHETIC_OTLP_TRACE_SINK_URL: `${server.url}v1/traces`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await child.exited;

    expect(exitCode).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
    const exported = requests.join("");
    expect(exported).toContain("[REDACTED]");
    expect(exported).not.toContain("SENSITIVE-CATEGORY-SENTINEL");
  } finally {
    server.stop(true);
  }
});

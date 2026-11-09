// Runs runCommand under Node, as Playwright's workers do, and prints what it
// returned. Node strips command.ts's types; the dynamic import keeps the
// `.ts` extension out of type-checked code.
const { runCommand } = await import("./command.ts");

const settle = (promise) =>
  promise.then(
    (result) => ({ result }),
    (cause) => ({ rejected: String(cause) })
  );

const results = {
  captured: await settle(
    runCommand(["sh", "-c", "cat; echo err >&2; exit 3"], { stdin: "hello" })
  ),
  terminated: await settle(
    runCommand(
      [
        "sh",
        "-c",
        "trap 'echo term; exit 0' TERM; echo ready; while :; do sleep 0.05; done",
      ],
      { terminateGraceMs: 5_000, timeoutMs: 300 }
    )
  ),
  missing: await settle(runCommand(["/nonexistent/command-fixture"])),
  // The command exits on SIGTERM and leaves a descendant that ignores it;
  // the test checks that the descendant ends too.
  orphaning: await settle(
    runCommand(["bash", "-c", process.argv[2]], {
      terminateGraceMs: 5_000,
      timeoutMs: 300,
    })
  ),
};
process.stdout.write(JSON.stringify(results));

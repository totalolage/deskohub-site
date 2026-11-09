export {};

// A harness without an LLM for the harness process tests. It reads the
// request from stdin and ends the way its first argument names.
const mode = process.argv[2];

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

const request = JSON.parse(await readStdin()) as {
  readonly locale: string;
  readonly taskId: string;
};
process.stderr.write(`stub harness received ${request.taskId}\n`);

switch (mode) {
  case "answer":
    process.stdout.write(
      JSON.stringify({
        costUsd: 0.25,
        finalAnswer: `${request.taskId} ${request.locale}`,
        steps: 3,
      })
    );
    break;
  case "agent-error":
    process.stdout.write(
      JSON.stringify({ error: "gave up", finalAnswer: "", steps: 1 })
    );
    process.exitCode = 2;
    break;
  case "noisy-stdout":
    process.stdout.write("starting agent\n");
    process.stdout.write(JSON.stringify({ finalAnswer: "", steps: 0 }));
    break;
  case "exit":
    process.exitCode = 3;
    break;
  case "hang":
    setInterval(() => {}, 60_000);
    break;
  default:
    throw new Error(`unknown stub harness mode ${mode}`);
}

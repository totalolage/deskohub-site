// Runs a command that inherits this process's output, under Bun or Node, and
// then prints what runCommand returned after the command's own output. The
// dynamic import keeps the `.ts` extension out of type-checked code.
const { runCommand } = await import("./command.ts");

const result = await runCommand(
  ["sh", "-c", "echo out; echo err >&2; exit 3"],
  { output: "inherit" }
);
process.stdout.write(JSON.stringify(result));

const getArgument = (name: string) => {
  const index = Bun.argv.indexOf(name);
  const value = Bun.argv[index + 1];

  if (index === -1 || !value) {
    throw new Error(`Missing required ${name} argument.`);
  }

  return value;
};

const spec = getArgument("--spec");
const name = getArgument("--name");
const output = getArgument("--output");

const generator = Bun.spawn(
  [
    "bunx",
    "openapigen",
    "--spec",
    spec,
    "--name",
    name,
    "--format",
    "httpclient",
  ],
  {
    stderr: "inherit",
    stdout: "pipe",
  }
);
const generatedSource = await new Response(generator.stdout).text();
const exitCode = await generator.exited;

if (exitCode !== 0) {
  process.exit(exitCode);
}

const diagnosticHeader =
  "// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off\n";

await Bun.write(output, `${diagnosticHeader}${generatedSource}`);

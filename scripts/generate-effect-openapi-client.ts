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

const generatedErrorDecoder = `      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(${name}Error(tag, cause, response)),
      )`;
const statusPreservingErrorDecoder = `      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        ),
        (cause) => Effect.fail(${name}Error(tag, cause, response)),
      )`;

if (!generatedSource.includes(generatedErrorDecoder)) {
  throw new Error("Could not find the generated error response decoder.");
}

const hardenedSource = generatedSource.replace(
  generatedErrorDecoder,
  statusPreservingErrorDecoder
);

await Bun.write(output, `${diagnosticHeader}${hardenedSource}`);

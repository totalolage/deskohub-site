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

const generatedErrorDecoder =
  "HttpClientResponse.schemaBodyJson(schema)(response)";
const statusPreservingErrorDecoder = `${generatedErrorDecoder}.pipe(
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
        )`;
const decodeErrorStart = generatedSource.indexOf("  const decodeError =");
const decoderStart = generatedSource.indexOf(
  generatedErrorDecoder,
  decodeErrorStart
);
const operationsStart = generatedSource.indexOf("  return {", decodeErrorStart);

if (
  decodeErrorStart === -1 ||
  decoderStart === -1 ||
  operationsStart === -1 ||
  decoderStart >= operationsStart
) {
  throw new Error("Could not find the generated error response decoder.");
}

const hardenedSource = `${generatedSource.slice(0, decoderStart)}${statusPreservingErrorDecoder}${generatedSource.slice(decoderStart + generatedErrorDecoder.length)}`;

await Bun.write(output, `${diagnosticHeader}${hardenedSource}`);

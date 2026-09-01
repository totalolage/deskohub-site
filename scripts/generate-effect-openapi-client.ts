import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const convertNullableTo31 = Bun.argv.includes("--convert-nullable-to-31");

const schemaMarkers = [
  "allOf",
  "anyOf",
  "oneOf",
  "$ref",
  "enum",
  "items",
  "properties",
  "type",
];

const upgradeSchemaObject = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(upgradeSchemaObject);
  if (schema === null || typeof schema !== "object") return schema;

  const object = schema as Record<string, unknown>;
  const upgraded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key !== "nullable" && key !== "example") {
      upgraded[key] = upgradeSchemaObject(value);
    }
  }
  if (!schemaMarkers.some((marker) => marker in object)) return upgraded;

  if (object.example !== undefined) upgraded.examples = [object.example];
  return object.nullable === true
    ? { anyOf: [upgraded, { type: "null" }] }
    : upgraded;
};

const asOpenApi31Document = (source: string): string => {
  const document = Bun.YAML.parse(source) as Record<string, unknown>;
  document.openapi = "3.1.0";
  for (const section of ["paths", "components"]) {
    if (document[section] !== undefined) {
      document[section] = upgradeSchemaObject(document[section]);
    }
  }
  return Bun.YAML.stringify(document);
};

const workDirectory = await mkdtemp(join(tmpdir(), "deskohub-openapi-client-"));

try {
  const generatedPath = join(workDirectory, "client.ts");
  const generatorSpec = convertNullableTo31
    ? join(workDirectory, "spec-openapi-3.1.yaml")
    : spec;

  if (convertNullableTo31) {
    await Bun.write(
      generatorSpec,
      asOpenApi31Document(await Bun.file(spec).text())
    );
  }

  const generator = Bun.spawn(
    [
      "bunx",
      "openapigen",
      "--spec",
      generatorSpec,
      "--name",
      name,
      "--format",
      "httpclient",
    ],
    {
      stderr: "inherit",
      stdout: Bun.file(generatedPath),
    }
  );
  const exitCode = await generator.exited;

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  } else {
    const generatedSource = await Bun.file(generatedPath).text();

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
    const operationsStart = generatedSource.indexOf(
      "  return {",
      decodeErrorStart
    );

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
  }
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}

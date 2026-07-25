import { createHash } from "node:crypto";

const generatedClient = Bun.file(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
);
const pinnedSchema = Bun.file(
  new URL("../posthog-openapi.json.gz", import.meta.url)
);
const pinnedSchemaDigest = (
  await Bun.file(
    new URL("../posthog-openapi.json.gz.sha256", import.meta.url)
  ).text()
).trim();
const pinnedDigest = (
  await Bun.file(
    new URL("../src/generated/effect.gen.sha256", import.meta.url)
  ).text()
).trim();
const actualDigest = createHash("sha256")
  .update(new Uint8Array(await generatedClient.arrayBuffer()))
  .digest("hex");
const actualSchemaDigest = createHash("sha256")
  .update(new Uint8Array(await pinnedSchema.arrayBuffer()))
  .digest("hex");

if (actualDigest !== pinnedDigest) {
  throw new Error(
    "The generated PostHog client differs from its reviewed content digest."
  );
}
if (actualSchemaDigest !== pinnedSchemaDigest) {
  throw new Error(
    "The pinned PostHog OpenAPI schema differs from its reviewed content digest."
  );
}

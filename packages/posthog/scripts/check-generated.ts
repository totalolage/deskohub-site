import { createHash } from "node:crypto";

const generatedClient = Bun.file(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
);
const pinnedDigest = (
  await Bun.file(
    new URL("../src/generated/effect.gen.sha256", import.meta.url)
  ).text()
).trim();
const actualDigest = createHash("sha256")
  .update(new Uint8Array(await generatedClient.arrayBuffer()))
  .digest("hex");

if (actualDigest !== pinnedDigest) {
  throw new Error(
    "The generated PostHog client differs from its reviewed content digest."
  );
}

import { expect, test } from "bun:test";
import { join } from "node:path";

// The build embeds this copy (app.config.ts `updates.codeSigningCertificate`);
// the Workspace signs manifests with the key behind its own copy. They must
// stay the same certificate or every signed update is rejected on device.
test("matches the certificate the Workspace update server signs for", async () => {
  const appCopy = await Bun.file(
    join(import.meta.dir, "code-signing-certificate.pem")
  ).bytes();
  const serverCopy = await Bun.file(
    join(
      import.meta.dir,
      "../../deskohub-workspace/features/mobile-updates/code-signing-certificate.pem"
    )
  ).bytes();

  expect(appCopy.byteLength).toBeGreaterThan(0);
  expect(appCopy).toEqual(serverCopy);
});

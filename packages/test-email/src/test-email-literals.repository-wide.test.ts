import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { findRepositoryTestEmailLiterals } from "./test-email-literals";

const repositoryRoot = resolve(import.meta.dir, "../../..");
// The scan parses every repository test module, so it outlasts bun's 5s default.
const scanTimeoutMs = 30_000;

test(
  "repository tests build email addresses with testEmailAddress or resendSimulatorAddress from @deskohub/test-email",
  async () => {
    const { checkedModules, findings } =
      await findRepositoryTestEmailLiterals(repositoryRoot);

    expect(checkedModules).toBeGreaterThan(0);
    expect(
      findings.map(
        ({ address, column, line, path }) =>
          `${path}:${line}:${column} ${address}`
      )
    ).toEqual([]);
  },
  scanTimeoutMs
);

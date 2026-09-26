import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

/** Occurrence count over process output and environment documentation. */
const occurrences = (text: string, needle: string): number =>
  text.split(needle).length - 1;

import { administratorCredentialRegistrySchema } from "../shared/administrator/administrator-credentials";

const generatorScriptPath = fileURLToPath(
  new URL("./generate-administrator-credentials.sh", import.meta.url)
);

const generatorCommand = ["bash", generatorScriptPath];

const digest = (credential: string) =>
  createHash("sha256").update(credential, "utf8").digest("hex");

const decodeRegistry = Schema.decodeUnknownSync(
  administratorCredentialRegistrySchema
);

const runGenerator = (
  input: string,
  environment: Record<string, string> = {}
) => {
  const result = Bun.spawnSync({
    cmd: generatorCommand,
    env: { ...process.env, ...environment },
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe("administrator credential generator", () => {
  test("collects multiple administrators into one schema-valid assignment", () => {
    const result = runGenerator(
      "admin\nfirst-synthetic-password\noperator\nsecond-synthetic-password\n\n"
    );

    expect(result.exitCode).toBe(0);
    const expectedValue = `admin:${digest("admin:first-synthetic-password")}\noperator:${digest("operator:second-synthetic-password")}`;
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='${expectedValue}'\n`
    );
    expect(result.stdout.split("\n")).toHaveLength(3);

    expect(
      decodeRegistry(expectedValue).map(
        ({ username, credentialDigest }) => `${username}:${credentialDigest}`
      )
    ).toEqual(expectedValue.split("\n"));
  });

  test("keeps prompts and notices on stderr without plaintext passwords", () => {
    const result = runGenerator(
      "admin\nfirst-synthetic-password\noperator\nsecond-synthetic-password\n\n"
    );

    expect(result.stderr).toContain(
      "Administrator username (finish on empty): "
    );
    expect(result.stderr).toContain("Password for admin (hidden): ");
    expect(result.stderr).not.toContain("Rejected:");
    expect(result.stderr).not.toContain("first-synthetic-password");
    expect(result.stderr).not.toContain("second-synthetic-password");
    expect(result.stdout).not.toContain("first-synthetic-password");
    expect(result.stdout).not.toContain("second-synthetic-password");
  });

  test("rejects duplicate usernames and keeps the first credential", () => {
    const result = runGenerator("admin\npw-one\nadmin\noperator\npw-three\n\n");

    expect(result.exitCode).toBe(0);
    expect(
      occurrences(result.stderr, "Rejected: that username was already added.")
    ).toBe(1);
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw-one")}\noperator:${digest("operator:pw-three")}'\n`
    );
  });

  test("rejects usernames outside the allowed pattern", () => {
    const result = runGenerator(
      `Admin\n-admin\n.admin\nadmin name\n${"a".repeat(81)}\nadmin\npw\n\n`
    );

    expect(result.exitCode).toBe(0);
    expect(occurrences(result.stderr, "Rejected: usernames")).toBe(5);
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw")}'\n`
    );
  });

  test("reprompts until the password is not empty", () => {
    const result = runGenerator("admin\n\npw\n\n");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "Rejected: the password must not be empty."
    );
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw")}'\n`
    );
  });

  test("fails without an assignment when finishing before any entry", () => {
    const result = runGenerator("\n");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Rejected: add at least one administrator before finishing."
    );
  });

  test("fails without an assignment when the input ends during a password", () => {
    const result = runGenerator("admin\n");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Rejected: the input ended before a password was entered."
    );
  });

  test("keeps username validation invariant under a hostile inherited locale", () => {
    // Behavioral enforcement check: the generator must produce identical,
    // strictly C-locale validation no matter what locale the caller
    // exports. The baseline run and the hostile-locale run must agree on
    // both the rejection and the accepted credential.
    const input = "Admin\nadmin\npw\n\n";
    const baseline = runGenerator(input, { LC_ALL: "C", LANG: "C" });
    const hostile = runGenerator(input, {
      LC_ALL: "cs_CZ.UTF-8",
      LC_CTYPE: "cs_CZ.UTF-8",
      LANG: "cs_CZ.UTF-8",
    });

    expect(baseline.exitCode).toBe(0);
    expect(hostile.exitCode).toBe(0);
    expect(occurrences(hostile.stderr, "Rejected: usernames")).toBe(1);
    expect(hostile.stdout).toBe(baseline.stdout);
    expect(hostile.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw")}'\n`
    );
  });

  test("keeps username matching case-sensitive when the caller shell enabled nocasematch", () => {
    // Behavioral enforcement check: sourcing the generator from a shell
    // that enabled nocasematch must not relax the duplicate and pattern
    // checks; the script resets the shell option itself.
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-c",
        `shopt -s nocasematch; source '${generatorScriptPath}'`,
      ],
      stdin: new Blob(["Admin\nadmin\npw\noperator\npw-two\n\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(occurrences(result.stderr.toString(), "Rejected: usernames")).toBe(
      1
    );
    expect(result.stdout.toString()).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw")}\noperator:${digest("operator:pw-two")}'\n`
    );
  });

  test("digests the complete username and password bytes", () => {
    const result = runGenerator("admin\npass:word\n\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pass:word")}'\n`
    );
  });
});

/**
 * Parses environment documentation as KEY=VALUE configuration: assignment
 * keys map to their values (values may span continuation lines), and
 * comment lines are kept separately as documentation. Verdicts over the
 * parsed structure are semantic, never raw-text pins on the file.
 */
const parseEnvExample = (
  rawText: string
): {
  readonly assignments: ReadonlyMap<string, string>;
  readonly documentation: readonly string[];
} => {
  const assignments = new Map<string, string>();
  const documentation: string[] = [];
  const assignmentKey = /^[A-Z0-9_]+$/;
  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      documentation.push(trimmed.replace(/^#+\s*/, ""));
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator > 0 && assignmentKey.test(trimmed.slice(0, separator))) {
      assignments.set(
        trimmed.slice(0, separator),
        trimmed.slice(separator + 1)
      );
      continue;
    }
    const lastKey = [...assignments.keys()].at(-1);
    if (lastKey !== undefined && trimmed.length > 0) {
      assignments.set(lastKey, `${assignments.get(lastKey)}\n${trimmed}`);
    }
  }
  return { assignments, documentation };
};

describe("administrator credential tooling documentation", () => {
  test("exposes the generator as a package script", async () => {
    const packageJson = (await Bun.file(
      new URL("../package.json", import.meta.url)
    ).json()) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(packageJson.scripts["administrator-credentials:generate"]).toBe(
      "bash scripts/generate-administrator-credentials.sh"
    );
  });

  test("documents the registry format, command, and migration in .env.example", async () => {
    const rawEnvExample = await Bun.file(
      new URL("../.env.example", import.meta.url)
    ).text();
    const envConfig = parseEnvExample(rawEnvExample);

    const credentialAssignment = envConfig.assignments.get(
      "ADMIN_BASIC_AUTH_CREDENTIALS"
    );
    expect(credentialAssignment).toBeDefined();
    // The documented assignment is single-quoted; the semantic content is
    // the newline-separated entry list inside the quotes.
    const credentialEntries = (credentialAssignment ?? "")
      .replace(/^'/, "")
      .replace(/'$/, "")
      .split("\n")
      .filter((entry) => entry.length > 0);
    expect(credentialEntries.length).toBeGreaterThan(0);
    for (const entry of credentialEntries) {
      expect(entry).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}:.+$/);
    }

    const documentation = envConfig.documentation.join("\n");
    expect(documentation).toContain("username:<sha256(username:password)>");
    expect(documentation).toContain(
      "bun run administrator-credentials:generate"
    );
    expect(documentation).toContain("Required in every environment");
    expect(documentation).toContain(
      "reuse the previously configured single-credential digest"
    );
    expect(documentation).toContain("as the admin entry");
    expect(documentation).not.toContain("ADMIN_BASIC_AUTH_SHA256");
    expect([...envConfig.assignments.keys()]).not.toContain(
      "ADMIN_BASIC_AUTH_SHA256"
    );
  });

  test("keeps real credentials out of .env.example", async () => {
    const rawEnvExample = await Bun.file(
      new URL("../.env.example", import.meta.url)
    ).text();
    const envConfig = parseEnvExample(rawEnvExample);

    const credentialAssignment = envConfig.assignments.get(
      "ADMIN_BASIC_AUTH_CREDENTIALS"
    );
    expect(credentialAssignment).toBeDefined();
    expect(credentialAssignment).toContain(
      "replace_with_64_lowercase_hex_characters"
    );
    expect(/[0-9a-f]{64}/.test(credentialAssignment ?? "")).toBe(false);
  });
});

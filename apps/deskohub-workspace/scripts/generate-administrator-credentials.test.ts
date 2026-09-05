import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
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

const runGenerator = (input: string) => {
  const result = Bun.spawnSync({
    cmd: generatorCommand,
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

const countOccurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

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
      countOccurrences(
        result.stderr,
        "Rejected: that username was already added."
      )
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
    expect(countOccurrences(result.stderr, "Rejected: usernames")).toBe(5);
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

  test("rejects an uppercase username when the caller shell enabled nocasematch", () => {
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
    expect(
      countOccurrences(result.stderr.toString(), "Rejected: usernames")
    ).toBe(1);
    expect(result.stdout.toString()).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pw")}\noperator:${digest("operator:pw-two")}'\n`
    );
  });

  test("pins the C locale and case-sensitive matching for username validation", async () => {
    const script = await Bun.file(generatorScriptPath).text();

    expect(script).toContain("export LC_ALL=C");
    expect(script).toContain("shopt -u nocasematch");
  });

  test("digests the complete username and password bytes", () => {
    const result = runGenerator("admin\npass:word\n\n");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `ADMIN_BASIC_AUTH_CREDENTIALS='admin:${digest("admin:pass:word")}'\n`
    );
  });
});

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
    const envExample = await Bun.file(
      new URL("../.env.example", import.meta.url)
    ).text();

    expect(envExample).toContain("ADMIN_BASIC_AUTH_CREDENTIALS=");
    expect(envExample).toContain("username:<sha256(username:password)>");
    expect(envExample).toContain("bun run administrator-credentials:generate");
    expect(envExample).toContain("Required in every environment");
    expect(envExample).toContain(
      "reuse the previously configured single-credential digest"
    );
    expect(envExample).toContain("as the admin entry");
    expect(envExample).not.toContain("ADMIN_BASIC_AUTH_SHA256");
  });

  test("keeps real credentials out of .env.example", async () => {
    const envExample = await Bun.file(
      new URL("../.env.example", import.meta.url)
    ).text();

    const assignment = envExample
      .split("\n")
      .find((line) => line.startsWith("ADMIN_BASIC_AUTH_CREDENTIALS="));
    expect(assignment).toBeDefined();
    expect(assignment).toContain("replace_with_64_lowercase_hex_characters");
    expect(assignment).not.toMatch(/:[0-9a-f]{64}/);
  });
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  previewHostPlaceholder,
  sanitizePlaywrightTraceFile,
} from "./playwright-trace-sanitizer";
import { addRedaction } from "./redaction";

const origin = "https://deskohub-workspace-site-a1b2c3.vercel.app";
const host = new URL(origin).host;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "trace-sanitizer-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const writeTrace = async (entries: Record<string, Uint8Array>) => {
  const path = join(directory, "trace.zip");
  await writeFile(path, zipSync(entries));
  return path;
};

const events = (...lines: unknown[]) =>
  strToU8(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

test("deletes a trace it cannot read", async () => {
  const path = join(directory, "trace.zip");
  await writeFile(path, "not a zip");

  expect(sanitizePlaywrightTraceFile(path, { origins: [origin] })).toEqual({
    outcome: "deleted",
    reason: "the trace could not be sanitized",
  });
  expect(await readdir(directory)).toEqual([]);
});

test("deletes a trace whose events cannot be parsed", async () => {
  const path = await writeTrace({ "trace.trace": strToU8("{ not json\n") });

  expect(sanitizePlaywrightTraceFile(path, { origins: [origin] })).toEqual({
    outcome: "deleted",
    reason: "the trace could not be sanitized",
  });
  expect(await readdir(directory)).toEqual([]);
});

test("deletes a trace that still names the preview origin after sanitizing", async () => {
  const path = await writeTrace({
    "trace.trace": events({ type: "context-options", options: {} }),
    [`resources/${host}.txt`]: strToU8("x"),
  });

  expect(sanitizePlaywrightTraceFile(path, { origins: [origin] })).toEqual({
    outcome: "deleted",
    reason: "a secret or the preview origin remained after sanitizing",
  });
  expect(await readdir(directory)).toEqual([]);
});

test("replaces the trace with a sanitized copy", async () => {
  const secret = `registered-${randomUUID()}`;
  const cookie = `cookie-${randomUUID()}`;
  const bearer = `bearer-${randomUUID()}`;
  const password = `password-${randomUUID()}`;
  addRedaction(secret);
  // A screenshot's bytes around an embedded secret survive unchanged.
  const screenshot = Uint8Array.from([
    0xff,
    0xd8,
    ...strToU8(secret),
    0x00,
    0xff,
    0xd9,
  ]);
  const path = await writeTrace({
    "trace.trace": events(
      {
        type: "context-options",
        options: {
          baseURL: origin,
          extraHTTPHeaders: { authorization: `Bearer ${bearer}` },
          httpCredentials: { password, username: "synthetic" },
        },
      },
      {
        type: "before",
        method: "addCookies",
        params: {
          cookies: [{ name: "_vercel_jwt", value: cookie, url: origin }],
        },
      },
      {
        type: "log",
        message: `navigating to "${origin}/en-US?code=${secret}"`,
      },
      {
        type: "frame-snapshot",
        snapshot: {
          frameUrl: `${origin}/en-US`,
          html: ["HTML", {}, ["BODY", {}, ["P", {}, secret]]],
          resourceOverrides: [
            { sha1: "style.css", url: `${origin}/style.css?v=${secret}` },
          ],
        },
      }
    ),
    "trace.stacks": strToU8(
      JSON.stringify({ files: [`${origin}/chunk.js`], stacks: [] })
    ),
    "trace.network": events({
      type: "resource-snapshot",
      snapshot: {
        request: {
          url: `${origin}/en-US`,
          headers: [{ name: "Cookie", value: `_vercel_jwt=${cookie}` }],
          cookies: [],
          queryString: [],
        },
        response: {
          status: 200,
          headers: [],
          cookies: [],
          content: { mimeType: "text/html", _sha1: "body.html" },
        },
      },
    }),
    "resources/body.html": strToU8(`<p>${secret}</p>`),
    "resources/frame.jpeg": screenshot,
    "resources/style.css": strToU8(
      `body { background: url(${origin}/a.png); }`
    ),
  });

  const sanitization = sanitizePlaywrightTraceFile(path, { origins: [origin] });

  expect(sanitization).toEqual({
    outcome: "sanitized",
    path: join(directory, "sanitized-trace.zip"),
  });
  expect(await readdir(directory)).toEqual(["sanitized-trace.zip"]);
  const entries = unzipSync(
    readFileSync(join(directory, "sanitized-trace.zip"))
  );
  expect(Object.keys(entries).sort()).toEqual([
    "resources/frame.jpeg",
    "resources/style.css",
    "trace.network",
    "trace.stacks",
    "trace.trace",
  ]);
  for (const [name, bytes] of Object.entries(entries)) {
    const text = Buffer.from(bytes).toString("latin1");
    for (const value of [secret, cookie, bearer, password, host])
      expect({ name, leaked: text.includes(value) }).toEqual({
        name,
        leaked: false,
      });
  }
  expect(Buffer.from(entries["trace.trace"] ?? []).toString()).toContain(
    previewHostPlaceholder
  );
  const frame = entries["resources/frame.jpeg"] ?? new Uint8Array();
  expect([...frame.slice(0, 2)]).toEqual([0xff, 0xd8]);
  expect([...frame.slice(-3)]).toEqual([0x00, 0xff, 0xd9]);
});

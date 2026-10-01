import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Logger, References } from "effect";
import type { EmailMessage } from "../../types/email.types";
import { EmailProviderTag } from "../capabilities";
import { ConsoleEmailProviderLive } from "./console-provider";

const bearerText =
  "Sign in at https://preview.example/api/auth/magic-link/verify?token=secret-token";
const bearerHtml =
  '<a href="https://preview.example/verify?token=secret-token">Sign in</a>';
const sensitiveSubject = "Sign in to Deskohub Workspace";
const sensitiveRecipient = "ada@example.test";

const sensitiveMessage = (
  overrides: Partial<EmailMessage> = {}
): EmailMessage => ({
  from: { email: "reservations@workspace.deskohub.cz", name: "Deskohub" },
  to: { email: sensitiveRecipient },
  subject: sensitiveSubject,
  html: bearerHtml,
  text: bearerText,
  tags: ["auth"],
  metadata: { surface: "workspace" },
  sensitiveContent: true,
  ...overrides,
});

const ordinaryMessage = (
  overrides: Partial<EmailMessage> = {}
): EmailMessage => ({
  from: { email: "reservations@workspace.deskohub.cz", name: "Deskohub" },
  to: { email: "ada@example.test" },
  subject: "Reservation confirmed",
  html: "<p>Reservation confirmed</p>",
  text: "Reservation confirmed",
  tags: ["reservation-confirmation"],
  metadata: {},
  ...overrides,
});

const envState: { [key: string]: string | undefined } = {};

const setEnv = (key: string, value: string | undefined) => {
  if (!(key in envState)) envState[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  for (const [key, value] of Object.entries(envState)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete envState[key];
  }
});

const captureConsole = (): {
  records: unknown[][];
  restore: () => void;
} => {
  const records: unknown[][] = [];
  // biome-ignore lint/suspicious/noConsole: The test captures console output for leak assertions.
  const original = console.log;
  console.log = (...args: unknown[]) => {
    records.push(args);
  };
  return {
    records,
    restore: () => {
      console.log = original;
    },
  };
};

const collectStrings = (value: unknown, into: string[] = []): string[] => {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      collectStrings(item, into);
    }
  }
  return into;
};

const recordText = (records: readonly unknown[][]): string =>
  records
    .map((args) =>
      args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    )
    .map((parts) => parts.join(" "))
    .join("\n");

type CapturedLogEntry = {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
};

const captureLogs = (entries: CapturedLogEntry[]) =>
  Logger.make((options) => {
    const parts = Array.isArray(options.message)
      ? options.message
      : [options.message];
    const message = parts[0];
    const inlineAnnotations =
      parts.length > 1 && parts[1] && typeof parts[1] === "object"
        ? (parts[1] as Record<string, unknown>)
        : {};
    const fiberAnnotations = options.fiber.getRef(
      References.CurrentLogAnnotations
    ) as Readonly<Record<string, unknown>> | undefined;
    entries.push({
      message,
      annotations: { ...fiberAnnotations, ...inlineAnnotations },
    });
  });

const logEntriesText = (entries: readonly CapturedLogEntry[]): string =>
  JSON.stringify(entries);

const send = (message: EmailMessage) => {
  const logEntries: CapturedLogEntry[] = [];
  const capture = captureConsole();
  const promise = Effect.runPromise(
    EmailProviderTag.pipe(
      Effect.provide(ConsoleEmailProviderLive),
      Effect.flatMap((provider) => provider.send(message)),
      Effect.provide(Logger.layer([captureLogs(logEntries)]))
    )
  );
  return promise
    .finally(() => capture.restore())
    .then((result) => {
      return { result, consoleRecords: capture.records, logEntries };
    });
};

const expectNoSensitiveLeaks = (
  consoleRecords: readonly unknown[][],
  logEntries: readonly CapturedLogEntry[]
) => {
  const consoleStrings = collectStrings(consoleRecords as unknown);
  const logStrings = collectStrings(logEntries as unknown);
  for (const secret of [
    "secret-token",
    sensitiveSubject,
    bearerText,
    bearerHtml,
    sensitiveRecipient,
  ]) {
    expect(consoleStrings).not.toContain(secret);
    expect(logStrings).not.toContain(secret);
    expect(recordText(consoleRecords)).not.toContain(secret);
    expect(logEntriesText(logEntries)).not.toContain(secret);
  }
};

describe("Console email provider sensitive content", () => {
  test("development: sensitive message leaks no recipient, subject, body, or bearer material", async () => {
    setEnv("NODE_ENV", "development");
    const { result, consoleRecords, logEntries } = await send(
      sensitiveMessage()
    );

    expect(result).toMatchObject({ status: "sent", provider: "console" });
    expectNoSensitiveLeaks(consoleRecords, logEntries);
  });

  test("Preview: sensitive message leaks no recipient, subject, body, or bearer material", async () => {
    setEnv("VERCEL_ENV", "preview");
    const { result, consoleRecords, logEntries } = await send(
      sensitiveMessage()
    );

    expect(result).toMatchObject({ status: "sent", provider: "console" });
    expectNoSensitiveLeaks(consoleRecords, logEntries);
  });

  test("development: sensitive message emits no dev banner and no raw console output", async () => {
    setEnv("NODE_ENV", "development");
    const { consoleRecords } = await send(sensitiveMessage());

    expect(consoleRecords).toEqual([]);
  });

  test("Preview: sensitive message emits no dev banner and no raw console output", async () => {
    setEnv("VERCEL_ENV", "preview");
    const { consoleRecords } = await send(sensitiveMessage());

    expect(consoleRecords).toEqual([]);
  });

  test("sensitive message logs only non-PII facts", async () => {
    setEnv("NODE_ENV", "development");
    const { logEntries } = await send(sensitiveMessage());

    const sendEntry = logEntries.find((entry) =>
      String(entry.message).includes("Sending Email")
    );
    expect(sendEntry).toBeDefined();
    expect(sendEntry?.annotations).toMatchObject({
      category: "auth",
      hasHtml: true,
      hasText: true,
      sensitive: true,
    });
    const annotationKeys = Object.keys(sendEntry?.annotations ?? {});
    expect(annotationKeys.sort()).toEqual([
      "category",
      "hasHtml",
      "hasText",
      "sensitive",
    ]);
  });

  test("sensitiveContent=true suppresses everything regardless of environment", async () => {
    for (const env of [
      { NODE_ENV: "development" },
      { VERCEL_ENV: "preview" },
      { NODE_ENV: "development", VERCEL_ENV: "preview" },
      {},
    ]) {
      for (const [key, value] of Object.entries(env)) setEnv(key, value);
      const { result, consoleRecords, logEntries } = await send(
        sensitiveMessage()
      );

      expect(result).toMatchObject({ status: "sent", provider: "console" });
      expectNoSensitiveLeaks(consoleRecords, logEntries);
      expect(recordText(consoleRecords)).not.toContain("EMAIL CONTENT");
    }
  });
});

describe("Console email provider ordinary behavior", () => {
  test("non-sensitive message in development keeps recipient, subject, and dev banner", async () => {
    setEnv("NODE_ENV", "development");
    const { result, consoleRecords, logEntries } = await send(
      ordinaryMessage()
    );

    expect(result).toMatchObject({ status: "sent", provider: "console" });

    const logged = recordText(consoleRecords);
    expect(logged).toContain("ada@example.test");
    expect(logged).toContain("Reservation confirmed");
    expect(logged).toContain("EMAIL CONTENT");

    const sendEntry = logEntries.find((entry) =>
      String(entry.message).includes("Sending Email")
    );
    expect(sendEntry?.annotations).toMatchObject({
      to: ["ada@example.test"],
      subject: "Reservation confirmed",
      hasHtml: true,
      hasText: true,
    });
  });

  test("non-sensitive message outside development keeps ordinary log without dev banner", async () => {
    setEnv("NODE_ENV", "production");
    const { consoleRecords, logEntries } = await send(ordinaryMessage());

    expect(recordText(consoleRecords)).not.toContain("EMAIL CONTENT");

    const sendEntry = logEntries.find((entry) =>
      String(entry.message).includes("Sending Email")
    );
    expect(sendEntry?.annotations).toMatchObject({
      to: ["ada@example.test"],
      subject: "Reservation confirmed",
    });
  });

  test("sensitiveContent=false keeps ordinary Console behavior", async () => {
    setEnv("NODE_ENV", "development");
    const { consoleRecords } = await send(
      ordinaryMessage({ sensitiveContent: false })
    );

    const logged = recordText(consoleRecords);
    expect(logged).toContain("ada@example.test");
    expect(logged).toContain("EMAIL CONTENT");
  });
});

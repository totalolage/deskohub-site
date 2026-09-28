import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { EmailMessage } from "../../types/email.types";
import { EmailProviderTag } from "../capabilities";
import {
  magicLinkPreviewE2ELogCode,
  magicLinkSyntheticRecipientPattern,
} from "../synthetic-recipient";
import { ConsoleEmailProviderLive } from "./console-provider";

const syntheticRecipient = "delivered+run7f3a2b-signin@resend.dev";
const magicLinkSubject = "Sign in to Deskohub Workspace";
const bearerText =
  "Sign in at https://preview.example/api/auth/magic-link/verify?token=secret-token";
const magicLinkHtml = "<p>Sign in link</p>";

const magicLinkMessage = (to: string): EmailMessage => ({
  from: { email: "reservations@workspace.deskohub.cz", name: "Deskohub" },
  to: { email: to },
  subject: magicLinkSubject,
  html: magicLinkHtml,
  text: bearerText,
  tags: ["account-magic-link"],
  metadata: { surface: "workspace" },
});

const otherMailMessage = (to: string): EmailMessage => ({
  ...magicLinkMessage(to),
  subject: "Reservation confirmed",
  tags: ["reservation-confirmation"],
  metadata: {},
});

const envState: { [key: string]: string | undefined } = {};

const setEnv = (key: string, value: string | undefined) => {
  if (!(key in envState)) envState[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const captureConsole = (): {
  records: unknown[][];
  restore: () => void;
} => {
  const records: unknown[][] = [];
  // biome-ignore lint/suspicious/noConsole: The test captures the authorized console delivery channel.
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

/** Structurally inspectable text of captured records: objects keep their fields. */
const recordText = (records: readonly unknown[][]): string =>
  records
    .map((args) =>
      args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    )
    .map((parts) => parts.join(" "))
    .join("\n");

/** Every string value reachable in the captured records, for leak scans. */
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

afterEach(() => {
  for (const [key, value] of Object.entries(envState)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete envState[key];
  }
});

const send = (message: EmailMessage) =>
  Effect.runPromise(
    EmailProviderTag.pipe(Effect.provide(ConsoleEmailProviderLive)).pipe(
      Effect.flatMap((provider) => provider.send(message))
    )
  );

describe("Console email provider preview E2E auth delivery", () => {
  test("preview + synthetic auth recipient: exactly one raw E2E line, no banner, no Effect body log", async () => {
    setEnv("VERCEL_ENV", "preview");
    setEnv("NODE_ENV", "development");
    const capture = captureConsole();

    try {
      const result = await send(magicLinkMessage(syntheticRecipient));
      expect(result).toMatchObject({ status: "sent", provider: "console" });
    } finally {
      capture.restore();
    }

    const e2eRecords = capture.records.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === "string" && arg.includes(magicLinkPreviewE2ELogCode)
      )
    );
    expect(e2eRecords).toHaveLength(1);
    const parsed = JSON.parse(e2eRecords[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual([
      "code",
      "message",
      "recipient",
      "text",
    ]);
    expect(parsed.code).toBe(magicLinkPreviewE2ELogCode);
    expect(parsed.recipient).toBe(syntheticRecipient);
    expect(parsed.text).toBe(bearerText);
    expect(recordText(e2eRecords)).not.toContain(magicLinkHtml);
    expect(recordText(e2eRecords)).not.toContain("\n");

    const rest = recordText(
      capture.records.filter((args) => !e2eRecords.includes(args))
    );
    expect(rest).not.toContain("secret-token");
    expect(rest).not.toContain("EMAIL CONTENT");
    expect(rest).not.toContain("Sign in link");
  });

  test("non-preview auth mail discloses no recipient, subject, text, or html", async () => {
    setEnv("NODE_ENV", "development");
    const capture = captureConsole();
    try {
      const result = await send(magicLinkMessage(syntheticRecipient));
      expect(result).toMatchObject({ status: "sent", provider: "console" });
    } finally {
      capture.restore();
    }

    const strings = collectStrings(capture.records);
    expect(
      strings.filter(
        (value) =>
          value === syntheticRecipient ||
          value === magicLinkSubject ||
          value === bearerText ||
          value === magicLinkHtml
      )
    ).toEqual([]);
    expect(recordText(capture.records)).not.toContain("secret-token");
    expect(recordText(capture.records)).not.toContain("EMAIL CONTENT");
  });

  test("non-synthetic Preview auth mail discloses no recipient, subject, text, or html", async () => {
    setEnv("VERCEL_ENV", "preview");
    const capture = captureConsole();
    try {
      await send(magicLinkMessage("ada@example.test"));
    } finally {
      capture.restore();
    }

    const strings = collectStrings(capture.records);
    expect(
      strings.filter(
        (value) =>
          value === "ada@example.test" ||
          value === magicLinkSubject ||
          value === bearerText ||
          value === magicLinkHtml
      )
    ).toEqual([]);
    expect(recordText(capture.records)).not.toContain("EMAIL CONTENT");
  });

  test("Preview + synthetic recipient without the auth marker emits no E2E line", async () => {
    setEnv("VERCEL_ENV", "preview");
    const capture = captureConsole();
    try {
      await send(otherMailMessage(syntheticRecipient));
    } finally {
      capture.restore();
    }

    expect(
      capture.records.filter((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" && arg.includes(magicLinkPreviewE2ELogCode)
        )
      )
    ).toEqual([]);
  });

  test("mixed recipient list on an auth message takes the silent path and still succeeds", async () => {
    setEnv("VERCEL_ENV", "preview");
    const capture = captureConsole();
    let result: Awaited<ReturnType<typeof send>> | undefined;
    try {
      result = await send({
        ...magicLinkMessage(syntheticRecipient),
        to: [{ email: syntheticRecipient }, { email: "ada@example.test" }],
      });
    } finally {
      capture.restore();
    }

    expect(result).toMatchObject({ status: "sent", provider: "console" });
    const logged = recordText(capture.records);
    expect(logged).not.toContain(magicLinkPreviewE2ELogCode);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain(magicLinkSubject);
    expect(logged).not.toContain(magicLinkHtml);
    expect(collectStrings(capture.records)).not.toContain(syntheticRecipient);
  });

  test("ordinary non-auth console mail keeps its current behavior", async () => {
    setEnv("NODE_ENV", "development");
    const capture = captureConsole();
    try {
      await send(otherMailMessage("ada@example.test"));
    } finally {
      capture.restore();
    }

    const logged = recordText(capture.records);
    expect(logged).toContain("ada@example.test");
    expect(logged).toContain("Reservation confirmed");
    expect(logged).toContain("EMAIL CONTENT");
  });

  test("synthetic recipient contract stays exact", () => {
    expect(magicLinkSyntheticRecipientPattern.test(syntheticRecipient)).toBe(
      true
    );
    expect(
      magicLinkSyntheticRecipientPattern.test("delivered+run@evil.test")
    ).toBe(false);
  });
});

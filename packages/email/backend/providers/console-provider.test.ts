import { expect, spyOn, test } from "bun:test";
import { Effect, Logger, References } from "effect";
import type { EmailMessage } from "../../types/email.types";
import { EmailProviderTag } from "../service";
import { ConsoleEmailProviderLive } from "./console-provider";

test("keeps console transport logs free of message contact and content fields", async () => {
  const markers = {
    sender: "synthetic-sender-marker@example.test",
    recipient: "synthetic-recipient-marker@example.test",
    subject: "SyntheticConsoleSubjectMarker",
    text: "SyntheticConsoleTextMarker",
    html: "SyntheticConsoleHtmlMarker",
  } as const;
  const records: unknown[] = [];
  const consoleRecords: unknown[][] = [];
  const logger = Logger.make((options) => {
    records.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      message: options.message,
    });
  });
  const consoleLog = spyOn(console, "log").mockImplementation((...args) => {
    consoleRecords.push(args);
  });
  const message: EmailMessage = {
    from: { email: markers.sender },
    to: { email: markers.recipient },
    subject: markers.subject,
    text: markers.text,
    html: `<p>${markers.html}</p>`,
  };

  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.send(message);
      }).pipe(
        Effect.provide(ConsoleEmailProviderLive),
        Effect.provide(Logger.layer([logger]))
      )
    );

    expect(result).toMatchObject({
      provider: "console",
      status: "sent",
    });
    const serialized = JSON.stringify({ consoleRecords, records });
    for (const marker of Object.values(markers)) {
      expect(serialized).not.toContain(marker);
    }
  } finally {
    consoleLog.mockRestore();
  }
});

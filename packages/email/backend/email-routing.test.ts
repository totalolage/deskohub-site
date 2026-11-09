import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger } from "effect";

type SendImplementation = (payload?: {
  readonly subject?: string;
}) => Promise<{ readonly data: { id: string } }>;
type BatchSendImplementation = (
  payload?: readonly unknown[],
  options?: { readonly idempotencyKey?: string }
) => Promise<{ readonly data: { readonly data: readonly { id: string }[] } }>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));
let resendBatchSend = mock<BatchSendImplementation>(async (payload = []) => ({
  data: {
    data: payload.map((_, index) => ({ id: `resend-batch-${index}` })),
  },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: (payload?: { readonly subject?: string }) => resendSend(payload),
    };
    batch = {
      send: (
        payload?: readonly unknown[],
        options?: { idempotencyKey?: string }
      ) => resendBatchSend(payload, options),
    };
    domains = { list: async () => ({ data: [] }) };
  },
}));

const {
  internalRecipientForOrigin,
  RoutedEmailProviderLive,
  routeEmailMessage,
  staffEmailSubject,
} = await import("./email-routing");
const { EmailConfigTag, EmailProviderTag } = await import("./capabilities");
const { isTestEmailRecipient } = await import("./test-recipients");
const { resendSimulatorAddress, testEmailAddress } = await import(
  "@deskohub/test-email"
);

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  resendBatchSend = mock<BatchSendImplementation>(async (payload = []) => ({
    data: {
      data: payload.map((_, index) => ({ id: `resend-batch-${index}` })),
    },
  }));
});

const testRecipient = { email: testEmailAddress("ada") };
// Resend's simulator is a real destination, never a test recipient.
const realRecipient = { email: resendSimulatorAddress("delivered", "ada") };
const sender = { email: testEmailAddress("deskohub") };

const message = (
  to: { email: string } | { email: string }[],
  subject = "Hello"
) => ({
  from: sender,
  to,
  subject,
  text: "Hello",
});

/** Sends one message through the routed provider, capturing its log output. */
const sendRouted = async (
  to: { email: string } | { email: string }[],
  apiKey?: string,
  subject?: string
) => {
  const logMessages: unknown[] = [];
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* EmailProviderTag;
      return yield* provider.send(message(to, subject));
    }).pipe(
      Effect.provide(
        RoutedEmailProviderLive.pipe(
          Layer.provide(
            Layer.succeed(EmailConfigTag, {
              apiKey,
              defaultFrom: sender,
            })
          )
        )
      ),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logMessages.push(options.message);
          }),
        ])
      ),
      Effect.result
    )
  );
  return Object.assign(result, { logged: JSON.stringify(logMessages) });
};

describe("isTestEmailRecipient", () => {
  test("accepts any address on the test domain", () => {
    expect(isTestEmailRecipient(testRecipient.email)).toBe(true);
    expect(
      isTestEmailRecipient(` ${testEmailAddress("Workspace").toUpperCase()} `)
    ).toBe(true);
  });

  test("rejects Resend simulator, look-alike, and empty addresses", () => {
    for (const outcome of ["delivered", "bounced", "complained"] as const) {
      expect(isTestEmailRecipient(resendSimulatorAddress(outcome))).toBe(false);
    }
    expect(isTestEmailRecipient(`${testRecipient.email}.evil`)).toBe(false);
    expect(isTestEmailRecipient(testRecipient.email.replace("@", "@not"))).toBe(
      false
    );
    expect(isTestEmailRecipient("")).toBe(false);
  });
});

describe("routeEmailMessage", () => {
  test("routes mail for test recipients only to Console", () => {
    expect(routeEmailMessage({ to: testRecipient })).toBe("console");
    expect(
      routeEmailMessage({
        to: [testRecipient, { email: testEmailAddress("internal") }],
      })
    ).toBe("console");
  });

  test("routes mail reaching any other recipient to Resend", () => {
    expect(routeEmailMessage({ to: realRecipient })).toBe("resend");
    expect(routeEmailMessage({ to: [testRecipient, realRecipient] })).toBe(
      "resend"
    );
    expect(routeEmailMessage({ to: testRecipient, cc: realRecipient })).toBe(
      "resend"
    );
    expect(routeEmailMessage({ to: testRecipient, bcc: [realRecipient] })).toBe(
      "resend"
    );
  });
});

describe("internalRecipientForOrigin", () => {
  const mailbox = {
    real: {
      email: resendSimulatorAddress("delivered", "staff"),
      name: "Staff",
    },
    testLocalPart: "staff",
  };

  test("keeps staff copies of test-recipient requests on the test domain", () => {
    expect(internalRecipientForOrigin(testRecipient.email, mailbox)).toEqual({
      email: testEmailAddress("staff"),
      name: "Staff",
    });
  });

  test("sends staff copies of other requests to the real mailbox", () => {
    expect(internalRecipientForOrigin(realRecipient.email, mailbox)).toBe(
      mailbox.real
    );
  });
});

describe("RoutedEmailProviderLive", () => {
  const sendBatchRouted = async (
    messages: ReturnType<typeof message>[],
    apiKey: string | undefined,
    idempotencyKey: string
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.sendBatch(messages, { idempotencyKey });
      }).pipe(
        Effect.provide(
          RoutedEmailProviderLive.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                apiKey,
                defaultFrom: sender,
              })
            )
          )
        )
      )
    );

  test("delivers real-recipient mail through Resend", async () => {
    const result = await sendRouted(realRecipient, "re_test");

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("resend");
    }
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  test("routes only real recipients through Resend and restores batch result order", async () => {
    const messages = [
      message(testRecipient, "Console one"),
      message(realRecipient, "Resend one"),
      message(testRecipient, "Console two"),
      message(realRecipient, "Resend two"),
    ];

    const results = await sendBatchRouted(
      messages,
      "re_test",
      "campaign-batch-key"
    );

    expect(resendBatchSend).toHaveBeenCalledTimes(1);
    const [payload, options] = resendBatchSend.mock.calls[0] ?? [];
    expect(payload).toHaveLength(2);
    expect(
      (
        payload as readonly {
          readonly subject?: string;
          readonly to: readonly string[];
        }[]
      ).map((sent) => ({ subject: sent.subject, to: sent.to }))
    ).toEqual([
      { subject: "Resend one", to: [realRecipient.email] },
      { subject: "Resend two", to: [realRecipient.email] },
    ]);
    expect(options).toMatchObject({ idempotencyKey: "campaign-batch-key" });
    expect(results.map((result) => result.provider)).toEqual([
      "console",
      "resend",
      "console",
      "resend",
    ]);
    expect(results[0]?.id.startsWith("console-")).toBe(true);
    expect(results[1]?.id).toBe("resend-batch-0");
    expect(results[2]?.id.startsWith("console-")).toBe(true);
    expect(results[3]?.id).toBe("resend-batch-1");
  });

  test("routes every batch message through Console without a Resend key", async () => {
    const results = await sendBatchRouted(
      [
        message(testRecipient, "Console one"),
        message(realRecipient, "Console two"),
      ],
      undefined,
      "campaign-batch-key"
    );

    expect(resendBatchSend).not.toHaveBeenCalled();
    expect(results.map((result) => result.provider)).toEqual([
      "console",
      "console",
    ]);
    expect(results.every((result) => result.id.startsWith("console-"))).toBe(
      true
    );
  });

  test("keeps test-recipient mail on Console when a Resend key exists", async () => {
    const result = await sendRouted(testRecipient, "re_test");

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("console");
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("logs every message through Console without a Resend key", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      for (const to of [realRecipient, [testRecipient, realRecipient]]) {
        const result = await sendRouted(to, apiKey);

        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          expect(result.success.provider).toBe("console");
        }
      }
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("keeps the test tag on staff copies outside production on both providers", async () => {
    const subject = staffEmailSubject("New request", { isProduction: false });

    const routedToConsole = await sendRouted(realRecipient, undefined, subject);
    expect(routedToConsole._tag).toBe("Success");
    expect(routedToConsole.logged).toContain("[TESTING] New request");

    const routedToResend = await sendRouted(realRecipient, "re_test", subject);
    expect(routedToResend._tag).toBe("Success");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0]?.[0]?.subject).toBe(
      "[TESTING] New request"
    );
  });
});

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Predicate } from "effect";

type SendPayload = {
  from?: string;
  to?: readonly string[];
  subject?: string;
  html?: string;
  text?: string;
  tags?: readonly { name: string; value: string }[];
};
type SendResponse =
  | { readonly data: { readonly id: string }; readonly error?: never }
  | {
      readonly data?: never;
      readonly error: {
        readonly message: string;
        readonly statusCode?: number;
      };
    };
type SendImplementation = (
  payload?: SendPayload,
  options?: { readonly idempotencyKey?: string }
) => Promise<SendResponse>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
    domains = { list: async () => ({ data: [] }) };
  },
}));

const {
  isSyntheticE2EEmailRecipient,
  MagicLinkDeliveryTransportError,
  magicLinkPreviewE2ELogCode,
  makeMagicLinkEmailDelivery,
  routeMagicLinkEmail,
} = await import("./send-magic-link-email");

const request = {
  email: "ada@example.test",
  url: "https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  locale: "en-US" as const,
};

const syntheticRequest = {
  ...request,
  email: "delivered+run7f3a2b-signin@resend.dev",
};

const renderOk = () =>
  Effect.succeed({
    subject: "Sign in",
    html: "<p>Sign in link</p>",
    text: "Sign in at https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  });

const routing = {
  preview: { isVercelPreview: true, resendApiKey: "resend-key" },
  production: { isVercelPreview: false, resendApiKey: "resend-key" },
  unconfigured: { isVercelPreview: false, resendApiKey: undefined },
};

const captureConsoleLog = (): string[] & { restore: () => void } => {
  const lines: string[] = [];
  // biome-ignore lint/suspicious/noConsole: The test captures the authorized console delivery channel.
  const original = console.log;
  console.log = (...args: unknown[]) => {
    // Structurally inspectable: objects keep their fields via JSON instead
    // of degrading to "[object Object]".
    lines.push(
      args
        .map((arg) =>
          Predicate.isString(arg) ? arg : (JSON.stringify(arg) ?? "")
        )
        .join(" ")
    );
  };
  const captured = lines as string[] & { restore: () => void };
  captured.restore = () => {
    console.log = original;
  };
  return captured;
};

const previewE2ELines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes(magicLinkPreviewE2ELogCode));

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

describe("Magic-link email delivery through the shared email service", () => {
  test("sends through exactly one shared EmailServiceTag send with the rendered message", async () => {
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.production).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    const payload = resendSend.mock.calls[0]?.[0];
    expect(payload?.to).toEqual([request.email]);
    expect(payload?.subject).toBe("Sign in");
    expect(payload?.html).toContain("Sign in link");
    expect(payload?.text).toContain(request.url);
    expect(payload?.tags).toEqual([
      { name: "category", value: "account-magic-link" },
      { name: "surface", value: "workspace" },
    ]);
  });

  test("reports provider rejection with the fixed censored code and no provider detail", async () => {
    resendSend = mock<SendImplementation>(async () => ({
      error: { message: "quota exceeded for api key", statusCode: 429 },
    }));
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.production).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-rejected");
    const logged = consoleLines.join("\n");
    expect(logged).not.toContain("quota exceeded");
    expect(logged).not.toContain(request.email);
    expect(logged).not.toContain("secret-token");
  });

  test("reports transport failures without leaking after shared-service retries", async () => {
    resendSend = mock<SendImplementation>(async () => {
      throw new Error("network failure with secret detail");
    });
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.production).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-failed");
    expect(resendSend.mock.calls.length).toBeGreaterThan(1);
    const logged = consoleLines.join("\n");
    expect(logged).not.toContain("network failure");
    expect(logged).not.toContain(request.email);
    expect(logged).not.toContain("secret-token");
  }, 20_000);

  test("fails with an account-owned tagged transport error", () => {
    const transport = new MagicLinkDeliveryTransportError();

    expect(transport._tag).toBe("MagicLinkDeliveryTransportError");
    expect(transport).toBeInstanceOf(Error);
  });

  test("reports renderer failures without leaking the message", async () => {
    const code = await Effect.runPromise(
      makeMagicLinkEmailDelivery(
        () => Effect.fail(new Error("render exploded with secret-token")),
        routing.production
      ).deliver(request)
    );

    expect(code).toBe("account.magic-link.delivery-failed");
  });

  test("stays unconfigured without a credential and never renders or sends", async () => {
    let rendered = false;
    const code = await Effect.runPromise(
      makeMagicLinkEmailDelivery(() => {
        rendered = true;
        return renderOk();
      }, routing.unconfigured).deliver(request)
    );

    expect(code).toBe("account.magic-link.delivery-unconfigured");
    expect(rendered).toBe(false);
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("never logs the recipient, bearer URL, or token on the accepted path", async () => {
    const captured: unknown[][] = [];
    const originalConsole = { ...console };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      console[method] = (...args: unknown[]) => {
        captured.push(args);
      };
    }

    try {
      const code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.production).deliver(
          request
        )
      );
      expect(code).toBe("account.magic-link.delivery-accepted");
    } finally {
      Object.assign(console, originalConsole);
    }

    const logged = JSON.stringify(captured);
    expect(logged).not.toContain("ada@example.test");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("verify?token");
    expect(logged).not.toContain("Sign in link");
  });
});

describe("Recipient-based provider routing", () => {
  test("synthetic Preview recipient routes to the shared Console provider", () => {
    expect(routeMagicLinkEmail(routing.preview, syntheticRequest.email)).toBe(
      "preview-e2e-console"
    );
    expect(
      routeMagicLinkEmail(routing.unconfigured, syntheticRequest.email)
    ).toBe("unconfigured");
  });

  test("non-synthetic Preview recipients route to Resend or fail closed", () => {
    expect(routeMagicLinkEmail(routing.preview, request.email)).toBe("resend");
    expect(
      routeMagicLinkEmail(
        { isVercelPreview: true, resendApiKey: undefined },
        request.email
      )
    ).toBe("unconfigured");
  });

  test("production and development never route to Console", () => {
    expect(
      routeMagicLinkEmail(routing.production, syntheticRequest.email)
    ).toBe("resend");
    expect(
      routeMagicLinkEmail(routing.unconfigured, syntheticRequest.email)
    ).toBe("unconfigured");
  });
});

describe("Synthetic Preview routing through the shared Console provider", () => {
  let originalVercelEnv: string | undefined;
  beforeEach(() => {
    originalVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
  });
  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  test("emits exactly one E2E text log line and zero Resend sends", async () => {
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.preview).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();

    const e2eLines = previewE2ELines(consoleLines);
    expect(e2eLines).toHaveLength(1);
    const parsed = JSON.parse(e2eLines[0]!) as {
      code?: unknown;
      message?: unknown;
      recipient?: unknown;
      text?: unknown;
    };
    expect(Object.keys(parsed).sort()).toEqual([
      "code",
      "message",
      "recipient",
      "text",
    ]);
    expect(parsed.code).toBe(magicLinkPreviewE2ELogCode);
    expect(parsed.recipient).toBe(syntheticRequest.email);
    expect(e2eLines[0]).toContain(syntheticRequest.url);
    expect(e2eLines[0]).not.toContain("<p>");
    expect(e2eLines[0]).not.toContain("\n");
    expect(consoleLines.join("\n")).not.toContain("EMAIL CONTENT");
  });

  test("keeps the authorized line working without a Resend credential", async () => {
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, {
          isVercelPreview: true,
          resendApiKey: undefined,
        }).deliver(syntheticRequest)
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(previewE2ELines(consoleLines)).toHaveLength(1);
  });

  test("non-synthetic Preview recipients emit no E2E log line", async () => {
    const consoleLines = captureConsoleLog();
    let code: string | undefined;
    try {
      code = await Effect.runPromise(
        makeMagicLinkEmailDelivery(renderOk, routing.preview).deliver(request)
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain(syntheticRequest.url);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
  });
});

describe("Synthetic E2E email recipient pattern", () => {
  test("accepts run-id and label segments on the resend.dev test address", () => {
    expect(
      isSyntheticE2EEmailRecipient("delivered+run7f3a2b-signin@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("delivered+abc123-delete@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("delivered+a1b2-c3d4-e5f6-logout@resend.dev")
    ).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient("DELIVERED+run7f3a2b-signin@RESEND.DEV")
    ).toBe(true);
  });

  test("rejects malformed, bare, and arbitrary-domain addresses", () => {
    expect(isSyntheticE2EEmailRecipient("delivered@resend.dev")).toBe(false);
    expect(isSyntheticE2EEmailRecipient("delivered+onlylabel@resend.dev")).toBe(
      false
    );
    expect(isSyntheticE2EEmailRecipient("delivered+run-id-@resend.dev")).toBe(
      false
    );
    expect(
      isSyntheticE2EEmailRecipient("delivered+run--id-signin@resend.dev")
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient("delivered+run id-signin@resend.dev")
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient(
        "delivered+run7f3a2b-signin@resend.dev.evil.test"
      )
    ).toBe(false);
    expect(
      isSyntheticE2EEmailRecipient("delivered+run7f3a2b-signin@evil.test")
    ).toBe(false);
    expect(isSyntheticE2EEmailRecipient("ada@example.test")).toBe(false);
    expect(isSyntheticE2EEmailRecipient("")).toBe(false);
  });
});

import "@/shared/testing/workspace-test-environment";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailServiceError } from "@deskohub/email/backend/service";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect, Predicate } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";

mock.module("server-only", () => ({}));

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

const { magicLinkDeliveryEnvironment, makeMagicLinkEmailDelivery } =
  await import("./send-magic-link-email");
const {
  isSyntheticE2EEmailRecipient,
  magicLinkDevelopmentLogCode,
  magicLinkPreviewE2ELogCode,
} = await import("./magic-link-policy");

const request = {
  // Resend's simulator is a real destination, not a test recipient.
  email: resendSimulatorAddress("delivered", "ada"),
  url: "https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  locale: "en-US" as const,
};

const syntheticRequest = {
  ...request,
  email: testEmailAddress("delivered+run7f3a2b-signin"),
};

/** A test recipient outside the synthetic E2E account shape. */
const testRecipientRequest = {
  ...request,
  email: testEmailAddress("delivered"),
};

const renderOk = () =>
  Effect.succeed({
    subject: "Sign in",
    html: "<p>Sign in link</p>",
    text: "Sign in at https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  });

const previewEnvironment = magicLinkDeliveryEnvironment({
  VERCEL_ENV: "preview",
  NODE_ENV: "production",
});
const productionEnvironment = magicLinkDeliveryEnvironment({
  VERCEL_ENV: "production",
  NODE_ENV: "production",
});
const developmentEnvironment = magicLinkDeliveryEnvironment({
  VERCEL_ENV: "development",
  NODE_ENV: "development",
});

const resendEmailConfig = {
  EMAIL_API_KEY: "re_test",
};

/**
 * Runs one delivery with an explicit `EmailConfigLayer` configuration. The
 * shared default ConfigProvider snapshots the environment on first read, so
 * tests inject the provider per run instead of mutating `process.env`.
 */
const runDeliver = <A>(
  emailConfig: Record<string, string>,
  effect: Effect.Effect<A>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(emailConfig)
      )
    )
  );

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;

const captureConsole = (): string[] & { restore: () => void } => {
  const lines: string[] = [];
  // biome-ignore lint/suspicious/noConsole: The test captures the authorized console delivery channel.
  const original = consoleMethods.map((method) => console[method]);
  const capture = (...args: unknown[]) => {
    lines.push(
      args
        .map((arg) =>
          Predicate.isString(arg) ? arg : (JSON.stringify(arg) ?? "")
        )
        .join(" ")
    );
  };
  for (const method of consoleMethods) {
    console[method] = capture;
  }

  const captured = lines as string[] & { restore: () => void };
  captured.restore = () => {
    consoleMethods.forEach((method, index) => {
      // biome-ignore lint/suspicious/noConsole: The test restores the captured console channels.
      console[method] = original[index] ?? console[method];
    });
  };
  return captured;
};

const previewE2ELines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes(magicLinkPreviewE2ELogCode));

const developmentLines = (lines: readonly string[]) =>
  lines.filter((line) => line.includes(magicLinkDevelopmentLogCode));

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
});

describe("Recipient-based provider routing", () => {
  test("delivers a real recipient through Resend", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
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
    expect(previewE2ELines(consoleLines)).toEqual([]);
  });

  test("suppresses bearer content via the sensitiveContent marker for other test recipients", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          testRecipientRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    const logged = consoleLines.join("\n");
    expect(logged).toContain('"sensitive":true');
    expect(logged).not.toContain(testRecipientRequest.email);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("Sign in");
    expect(logged).not.toContain("EMAIL CONTENT");
    expect(previewE2ELines(consoleLines)).toEqual([]);
  });
});

describe("Synthetic Preview delivery through the shared Console provider", () => {
  test("emits exactly one E2E text log line and zero Resend sends without a Resend key", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        {},
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
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
    expect(parsed.text).toContain(syntheticRequest.url);
    expect(parsed.text).not.toContain("<p>");
    expect(e2eLines[0]).toContain(syntheticRequest.url);
    expect(e2eLines[0]).not.toContain("<p>");
    expect(e2eLines[0]).not.toContain("\n");
    expect(consoleLines.join("\n")).not.toContain("EMAIL CONTENT");
  });

  test("carries the sign-in code in the E2E text line of a rendered email", async () => {
    const { renderMagicLinkEmail } = await import("./magic-link-email");
    const consoleLines = captureConsole();
    try {
      await runDeliver(
        {},
        makeMagicLinkEmailDelivery(
          renderMagicLinkEmail,
          previewEnvironment
        ).deliver({ ...syntheticRequest, code: "482913" })
      );
    } finally {
      consoleLines.restore();
    }

    const [line] = previewE2ELines(consoleLines);
    const { text } = JSON.parse(line!) as { readonly text: string };
    expect(text.split("\n").map((textLine) => textLine.trim())).toContain(
      "482913"
    );
    expect(text).toContain(syntheticRequest.url);
  });

  test("keeps synthetic recipients on Console when a Resend key exists", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    expect(previewE2ELines(consoleLines)).toHaveLength(1);
  });

  test("real Preview recipients go to Resend with no E2E line", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, previewEnvironment).deliver(
          request
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
    expect(consoleLines.join("\n")).not.toContain(request.email);
  });

  test("synthetic recipients outside Preview stay on Console with no E2E line", async () => {
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          syntheticRequest
        )
      );
    } finally {
      consoleLines.restore();
    }

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
    expect(consoleLines.join("\n")).not.toContain(syntheticRequest.email);
  });
});

describe("Local development delivery through the shared Console provider", () => {
  const deliverInDevelopment = async (
    emailConfig: Record<string, string>,
    deliveryRequest: typeof request
  ) => {
    const consoleLines = captureConsole();
    try {
      const code = await runDeliver(
        emailConfig,
        makeMagicLinkEmailDelivery(renderOk, developmentEnvironment).deliver(
          deliveryRequest
        )
      );
      return { code, consoleLines: [...consoleLines] };
    } finally {
      consoleLines.restore();
    }
  };

  test("emits exactly one sign-in link line for a real recipient without a Resend key", async () => {
    const { code, consoleLines } = await deliverInDevelopment({}, request);

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    const lines = developmentLines(consoleLines);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      code: magicLinkDevelopmentLogCode,
      recipient: request.email,
      message: "Development magic link; open the url to sign in.",
      url: request.url,
    });
    expect(previewE2ELines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("EMAIL CONTENT");
  });

  test("adds the sign-in code to the development line when the email carries one", async () => {
    const { consoleLines } = await deliverInDevelopment(
      {},
      { ...request, code: "482913" }
    );

    expect(JSON.parse(developmentLines(consoleLines)[0]!)).toEqual({
      code: magicLinkDevelopmentLogCode,
      recipient: request.email,
      message: "Development magic link; open the url to sign in.",
      url: request.url,
      signInCode: "482913",
    });
  });

  test("emits the link for test recipients routed to Console with a Resend key", async () => {
    const { code, consoleLines } = await deliverInDevelopment(
      resendEmailConfig,
      syntheticRequest
    );

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).not.toHaveBeenCalled();
    expect(developmentLines(consoleLines)).toHaveLength(1);
    expect(previewE2ELines(consoleLines)).toEqual([]);
  });

  test("never emits the link when Resend delivers it", async () => {
    const { code, consoleLines } = await deliverInDevelopment(
      resendEmailConfig,
      request
    );

    expect(code).toBe("account.magic-link.delivery-accepted");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(developmentLines(consoleLines)).toEqual([]);
    expect(consoleLines.join("\n")).not.toContain("secret-token");
    expect(consoleLines.join("\n")).not.toContain(request.email);
  });

  test("Preview and Production never emit the development line", async () => {
    for (const environment of [previewEnvironment, productionEnvironment]) {
      for (const deliveryRequest of [request, syntheticRequest]) {
        const consoleLines = captureConsole();
        try {
          await runDeliver(
            {},
            makeMagicLinkEmailDelivery(renderOk, environment).deliver(
              deliveryRequest
            )
          );
        } finally {
          consoleLines.restore();
        }
        expect(developmentLines(consoleLines)).toEqual([]);
      }
    }
  });
});

describe("Magic-link delivery environment", () => {
  test("treats only next dev outside Vercel deployments as local development", () => {
    expect(
      magicLinkDeliveryEnvironment({
        VERCEL_ENV: "development",
        NODE_ENV: "development",
      })
    ).toEqual({ isVercelPreview: false, isLocalDevelopment: true });
    // bun test and production builds run without NODE_ENV=development.
    for (const NODE_ENV of ["test", "production", undefined]) {
      expect(
        magicLinkDeliveryEnvironment({ VERCEL_ENV: "development", NODE_ENV })
      ).toEqual({ isVercelPreview: false, isLocalDevelopment: false });
    }
  });

  test("never treats a Vercel deployment as local development", () => {
    for (const NODE_ENV of ["development", "production"]) {
      expect(
        magicLinkDeliveryEnvironment({ VERCEL_ENV: "preview", NODE_ENV })
      ).toEqual({ isVercelPreview: true, isLocalDevelopment: false });
      expect(
        magicLinkDeliveryEnvironment({ VERCEL_ENV: "production", NODE_ENV })
      ).toEqual({ isVercelPreview: false, isLocalDevelopment: false });
    }
  });
});

describe("Errors and log safety", () => {
  test("reports provider rejection with the fixed censored code and no provider detail", async () => {
    resendSend = mock<SendImplementation>(async () => ({
      error: { message: "quota exceeded for api key", statusCode: 429 },
    }));
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
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
    expect(logged).not.toContain("Sign in");
  });

  test("reports transport failures without leaking after shared-service retries", async () => {
    resendSend = mock<SendImplementation>(async () => {
      throw new Error("network failure with secret detail");
    });
    const consoleLines = captureConsole();
    let code: string | undefined;
    try {
      code = await runDeliver(
        resendEmailConfig,
        withInstantSleeps(
          makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
            request
          )
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
    expect(logged).not.toContain("Sign in");
  });

  test("reports renderer failures without leaking the message", async () => {
    const code = await runDeliver(
      resendEmailConfig,
      makeMagicLinkEmailDelivery(
        () =>
          Effect.fail(
            new EmailServiceError("render exploded with secret-token")
          ),
        productionEnvironment
      ).deliver(request)
    );

    expect(code).toBe("account.magic-link.delivery-failed");
  });

  test("logs a real recipient through Console without a Resend key", async () => {
    for (const environment of [productionEnvironment, previewEnvironment]) {
      const consoleLines = captureConsole();
      let code: string | undefined;
      try {
        code = await runDeliver(
          {},
          makeMagicLinkEmailDelivery(renderOk, environment).deliver(request)
        );
      } finally {
        consoleLines.restore();
      }

      expect(code).toBe("account.magic-link.delivery-accepted");
      const logged = consoleLines.join("\n");
      expect(logged).not.toContain(request.email);
      expect(logged).not.toContain("secret-token");
      expect(previewE2ELines(consoleLines)).toEqual([]);
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("never logs the recipient, bearer URL, or token on the accepted path", async () => {
    const consoleLines = captureConsole();
    try {
      const code = await runDeliver(
        resendEmailConfig,
        makeMagicLinkEmailDelivery(renderOk, productionEnvironment).deliver(
          request
        )
      );
      expect(code).toBe("account.magic-link.delivery-accepted");
    } finally {
      consoleLines.restore();
    }

    const logged = consoleLines.join("\n");
    expect(logged).not.toContain(request.email);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("verify?token");
    expect(logged).not.toContain("Sign in link");
  });
});

describe("Synthetic E2E email recipient pattern", () => {
  const synthetic = (localPart: string) =>
    isSyntheticE2EEmailRecipient(testEmailAddress(localPart));

  test("accepts run-id and label segments on the test domain", () => {
    expect(synthetic("delivered+run7f3a2b-signin")).toBe(true);
    expect(synthetic("delivered+abc123-delete")).toBe(true);
    expect(synthetic("delivered+a1b2-c3d4-e5f6-logout")).toBe(true);
    expect(
      isSyntheticE2EEmailRecipient(
        testEmailAddress("DELIVERED+run7f3a2b-signin").toUpperCase()
      )
    ).toBe(true);
  });

  test("rejects malformed, bare, and other-domain addresses", () => {
    expect(synthetic("delivered")).toBe(false);
    expect(synthetic("delivered+onlylabel")).toBe(false);
    expect(synthetic("delivered+run-id-")).toBe(false);
    expect(synthetic("delivered+run--id-signin")).toBe(false);
    expect(synthetic("delivered+run id-signin")).toBe(false);
    expect(isSyntheticE2EEmailRecipient(`${syntheticRequest.email}.evil`)).toBe(
      false
    );
    // Resend's simulator domain is never the test domain.
    expect(
      isSyntheticE2EEmailRecipient(
        resendSimulatorAddress("delivered", "run7f3a2b-signin")
      )
    ).toBe(false);
    expect(isSyntheticE2EEmailRecipient(request.email)).toBe(false);
    expect(isSyntheticE2EEmailRecipient("")).toBe(false);
  });
});

import { expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import {
  addDatabaseUrlRedactions,
  addRedaction,
  browserSessionFor,
  makePlaywrightBrowserRunner,
  type Runner,
  redact,
} from "./runtime";

type EvaluationFrame = {
  readonly evaluate: (expression: string) => Promise<unknown>;
};

const browserWithFrame = (frame: EvaluationFrame) => {
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  return {
    newContext: async () => context,
  } as Browser;
};

const runEval = (
  frame: EvaluationFrame,
  options: { readonly input: string; readonly timeoutMs: number }
) => {
  const run = makePlaywrightBrowserRunner(browserWithFrame(frame));
  return {
    close: () => run.close?.(),
    command: run("playwright", ["--session", "eval-test", "eval", "--stdin"], {
      input: options.input,
      timeoutMs: options.timeoutMs,
    }),
  };
};

test("redacts database connection identity fragments", () => {
  const connectionUrl =
    "postgresql://permit-user:permit-password@private-coordination.example.test/private-database";
  addDatabaseUrlRedactions(connectionUrl);

  const output = redact(
    `${connectionUrl} private-coordination.example.test private-database permit-user permit-password`
  );

  expect(output).not.toContain("private-coordination.example.test");
  expect(output).not.toContain("private-database");
  expect(output).not.toContain("permit-user");
  expect(output).not.toContain("permit-password");
});

test("redacts forced short values only as complete ASCII tokens", () => {
  const cvv = "741";
  const orderId = "550e8400-e29b-41d4-a741-446655440000";
  addRedaction(cvv, true);

  expect(
    redact(
      `${orderId} {"cvv":"${cvv}"} --cvv ${cvv} https://payments.example.test/verify?cvv=${cvv}&orderId=${orderId}`
    )
  ).toBe(
    `${orderId} {"cvv":"[redacted]"} --cvv [redacted] https://payments.example.test/verify?cvv=[redacted]&orderId=${orderId}`
  );
});

test("escapes punctuation in forced short values and encoded variants", () => {
  addRedaction("a.b", true);
  addRedaction("a+b", true);

  expect(redact("dot=a.b near=aXb plus=a+b encoded=a%2Bb nearPlus=ab")).toBe(
    "dot=[redacted] near=aXb plus=[redacted] encoded=[redacted] nearPlus=ab"
  );
});

test("keeps browser result IDs parseable while redacting forced short values", async () => {
  const cvv = "741";
  const orderId = "550e8400-e29b-41d4-a741-446655440000";
  addRedaction(cvv, true);

  const run = makePlaywrightBrowserRunner(
    browserWithFrame({
      evaluate: () => Promise.resolve({ orderId, cvv }),
    })
  );

  try {
    const result = await run(
      "playwright",
      ["--session", "redaction-result-test", "eval", "--stdin"],
      { input: "document.body.innerText" }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      orderId,
      cvv: "[redacted]",
    });
  } finally {
    await run.close?.();
  }
});

test("restores the remaining page when the current popup closes", async () => {
  let registerPopup: ((page: unknown) => void) | undefined;
  let closePopup: (() => void) | undefined;
  const checkoutPage = {
    isClosed: () => false,
    mainFrame: () => ({}),
    on: () => undefined,
    url: () => "https://workspace.test/checkout/status/order-id",
  };
  const popupPage = {
    mainFrame: () => ({}),
    on: (event: string, listener: () => void) => {
      if (event === "close") closePopup = listener;
    },
    url: () => "https://provider.test/hosted-payment",
  };
  const context = {
    close: async () => undefined,
    newPage: async () => checkoutPage,
    on: (event: string, listener: (page: unknown) => void) => {
      if (event === "page") registerPopup = listener;
    },
    pages: () => [checkoutPage],
  };
  const browser = {
    newContext: async () => context,
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", ["--session", "popup-test", "get", "url"]);
    registerPopup?.(popupPage);
    expect(
      (await run("playwright", ["--session", "popup-test", "get", "url"]))
        .stdout
    ).toBe("https://provider.test/hosted-payment");

    closePopup?.();
    expect(
      (await run("playwright", ["--session", "popup-test", "get", "url"]))
        .stdout
    ).toBe("https://workspace.test/checkout/status/order-id");
  } finally {
    await run.close?.();
  }
});

test("rejects a hanging browser evaluation within the command timeout", async () => {
  const realSetTimeout = setTimeout;
  const budgetDelays: number[] = [];
  const setTimeoutSpy = ((callback: () => void, delay?: number) => {
    budgetDelays.push(delay ?? 0);
    return realSetTimeout(callback, delay);
  }) as typeof setTimeout;
  globalThis.setTimeout = setTimeoutSpy;
  const evalRun = runEval(
    {
      evaluate: () => new Promise(() => undefined),
    },
    { input: "document.body.innerText", timeoutMs: 20 }
  );

  let failure: unknown;
  const startedAt = Date.now();
  const outcome = await Promise.race([
    evalRun.command.catch((cause: unknown) => {
      failure = cause;
      return "rejected within budget" as const;
    }),
    new Promise<"hung">((resolve) => {
      realSetTimeout(() => resolve("hung"), 2000);
    }),
  ]);

  try {
    expect(outcome).toBe("rejected within budget");
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(budgetDelays).toEqual([20]);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "frame.evaluate: Timeout 20ms exceeded"
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await evalRun.close();
  }
});

test("reports destroyed evaluation contexts before the command timeout", async () => {
  const evalRun = runEval(
    {
      evaluate: () =>
        Promise.reject(
          new Error(
            "frame.evaluate: Execution context was destroyed, most likely because of a navigation"
          )
        ),
    },
    { input: "document.body.innerText", timeoutMs: 5000 }
  );

  let failure: unknown;
  const outcome = await Promise.race([
    evalRun.command.catch((cause: unknown) => {
      failure = cause;
      return "reported through command failure" as const;
    }),
    new Promise<"hung">((resolve) => {
      setTimeout(() => resolve("hung"), 2000);
    }),
  ]);

  try {
    expect(outcome).toBe("reported through command failure");
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "Execution context was destroyed"
    );
    expect((failure as Error).message).not.toContain("Timeout 5000ms exceeded");
  } finally {
    await evalRun.close();
  }
});

test("fails typed when a runner has no browser sessions to bridge", async () => {
  const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });

  const failure = await Effect.runPromise(
    Effect.flip(browserSessionFor(run, "no-session"))
  );

  expect(failure.operation).toBe("open browser session");
  expect(failure.reason).not.toBe("timeout");
});

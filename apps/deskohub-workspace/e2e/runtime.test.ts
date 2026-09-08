import { expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import {
  addDatabaseUrlRedactions,
  addRedaction,
  makePlaywrightBrowserRunner,
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

test("targets the visible match for selector-based browser actions", async () => {
  let filteredForVisibility = false;
  const visibleLocator = {
    focus: async () => undefined,
  };
  const ambiguousLocator = {
    filter: (options: { readonly visible?: boolean }) => {
      filteredForVisibility = options.visible === true;
      return visibleLocator;
    },
    focus: async () => {
      throw new Error("strict mode violation: selector resolved to 2 elements");
    },
  };
  const frame = {
    locator: () => ambiguousLocator,
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", [
      "--session",
      "visible-selector-test",
      "focus",
      "[data-locale-switcher] a",
    ]);
  } finally {
    await run.close?.();
  }

  expect(filteredForVisibility).toBe(true);
});

test("types provider-controlled fields with user-like key timing", async () => {
  let typeOptions: { readonly delay?: number; readonly timeout?: number } = {};
  const visibleLocator = {
    pressSequentially: async (
      _value: string,
      options: { readonly delay?: number; readonly timeout?: number }
    ) => {
      typeOptions = options;
    },
  };
  const frame = {
    locator: () => ({ filter: () => visibleLocator }),
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run(
      "playwright",
      ["--session", "provider-field-test", "type", "input", "123"],
      { timeoutMs: 5000 }
    );
  } finally {
    await run.close?.();
  }

  expect(typeOptions).toEqual({ delay: 50, timeout: 5000 });
});

test("waits for the document body before taking a snapshot", async () => {
  const calls: string[] = [];
  const bodyLocator = {
    ariaSnapshot: async () => {
      calls.push("snapshot");
      return "- generic";
    },
    waitFor: async () => {
      calls.push("wait");
    },
  };
  const frame = {
    locator: () => bodyLocator,
  };
  const page = {
    mainFrame: () => frame,
    on: () => undefined,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
  };
  const browser = {
    newContext: async () => context,
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    await run("playwright", ["--session", "snapshot-test", "snapshot"]);
  } finally {
    await run.close?.();
  }

  expect(calls).toEqual(["wait", "snapshot"]);
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

test("returns browser evaluation results unchanged within the command timeout", async () => {
  const evaluateInputs: string[] = [];
  const run = makePlaywrightBrowserRunner(
    browserWithFrame({
      evaluate: (expression) => {
        evaluateInputs.push(expression);
        return Promise.resolve(
          evaluateInputs.length === 1
            ? { reservationText: "Table 4 - 2 seats" }
            : "Reserved table text"
        );
      },
    })
  );
  const command = (input: string) =>
    run("playwright", ["--session", "eval-success-test", "eval", "--stdin"], {
      input,
      timeoutMs: 5000,
    });

  try {
    const first = await command(
      "({ reservationText: document.body.innerText })"
    );
    const second = await command("document.body.innerText");

    expect(evaluateInputs).toEqual([
      "({ reservationText: document.body.innerText })",
      "document.body.innerText",
    ]);
    expect(first.stdout).toBe('{"reservationText":"Table 4 - 2 seats"}');
    expect(second.stdout).toBe("Reserved table text");
  } finally {
    await run.close?.();
  }
});

test("bounds preview access priming redirects before opening a page", async () => {
  const target = "https://workspace.test/en-US/reservation/status/order-id";
  let requestOptions: unknown;
  const page = {
    goto: async () => undefined,
    mainFrame: () => ({}),
    on: () => undefined,
    url: () => target,
  };
  const context = {
    close: async () => undefined,
    newPage: async () => page,
    on: () => undefined,
    request: {
      get: async (_url: string, options: unknown) => {
        requestOptions = options;
        return {
          dispose: async () => undefined,
          ok: () => true,
          status: () => 200,
        };
      },
    },
  };
  const browser = {
    newContext: async () => context,
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);

  try {
    const result = await run(
      "playwright",
      [
        "--session",
        "preview-priming-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "open",
        target,
      ],
      { logCommand: false, logOutput: false, timeoutMs: 5000 }
    );

    expect(result.stdout).toBe(target);
    expect(requestOptions).toEqual({
      headers: { "x-vercel-protection-bypass": "test-bypass" },
      maxRedirects: 3,
      timeout: 5000,
    });
  } finally {
    await run.close?.();
  }
});

test("returns only browser request metadata and disables HAR for an isolated request session", async () => {
  const requestUrl = "https://workspace.test/en-US/reservation/access/order-id";
  const cleanLocation = "https://workspace.test/clean";
  const wrongLocation = "https://workspace.test/wrong";
  const contextOptions: unknown[] = [];
  let requestOptions: unknown;
  let disposed = false;
  let responseLocation = cleanLocation;
  const page = {
    mainFrame: () => ({}),
    on: () => undefined,
  };
  const response = {
    dispose: async () => {
      disposed = true;
    },
    headers: () => ({ location: responseLocation }),
    headersArray: () => [
      {
        name: "set-cookie",
        value:
          "__Host-access=secret-cookie-value; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Expires=Wed, 01 Jan 2099 00:00:00 GMT",
      },
    ],
    status: () => 307,
  };
  const context = {
    close: async () => undefined,
    cookies: async () => [
      {
        domain: "workspace.test",
        expires: 4_070_908_800,
        httpOnly: true,
        name: "__Host-access",
        path: "/",
        sameSite: "Lax",
        secure: true,
      },
    ],
    newPage: async () => page,
    on: () => undefined,
    request: {
      get: async (_url: string, options: unknown) => {
        requestOptions = options;
        return response;
      },
    },
  };
  const browser = {
    newContext: async (options: unknown) => {
      contextOptions.push(options);
      return context;
    },
  } as Browser;
  const run = makePlaywrightBrowserRunner(browser);
  addRedaction(cleanLocation);
  addRedaction(wrongLocation);

  try {
    const result = await run(
      "playwright",
      [
        "--session",
        "request-metadata-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "--no-har",
        "--json",
        "request",
        "get",
        requestUrl,
      ],
      {
        logCommand: false,
        logOutput: false,
        request: { expectedLocation: cleanLocation, maxRedirects: 0 },
      }
    );

    expect(JSON.parse(result.stdout)).toEqual({
      cookies: [
        {
          domain: "workspace.test",
          expires: 4_070_908_800,
          httpOnly: true,
          name: "__Host-access",
          path: "/",
          sameSite: "Lax",
          secure: true,
        },
      ],
      locationMatches: true,
      setCookies: [
        {
          hasExpires: true,
          httpOnly: true,
          maxAge: 86400,
          name: "__Host-access",
          path: "/",
          sameSite: "lax",
          secure: true,
        },
      ],
      status: 307,
    });
    expect(result.stdout).not.toContain(cleanLocation);
    expect(result.stdout).not.toContain("secret-cookie-value");
    expect(result.stdout).not.toContain("test-bypass");
    expect(contextOptions[0]).toEqual({
      recordHar: undefined,
      viewport: { height: 900, width: 1440 },
    });
    expect(requestOptions).toEqual({
      headers: { "x-vercel-protection-bypass": "test-bypass" },
      maxRedirects: 0,
      timeout: 120_000,
    });
    expect(disposed).toBe(true);

    responseLocation = wrongLocation;
    const wrong = await run(
      "playwright",
      [
        "--session",
        "request-metadata-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "--no-har",
        "--json",
        "request",
        "get",
        requestUrl,
      ],
      {
        logCommand: false,
        logOutput: false,
        request: { expectedLocation: cleanLocation, maxRedirects: 0 },
      }
    );
    expect(JSON.parse(wrong.stdout).locationMatches).toBe(false);
    expect(wrong.stdout).not.toContain(wrongLocation);

    responseLocation = new URL(cleanLocation).pathname;
    const relative = await run(
      "playwright",
      [
        "--session",
        "request-metadata-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "--no-har",
        "--json",
        "request",
        "get",
        requestUrl,
      ],
      {
        logCommand: false,
        logOutput: false,
        request: { expectedLocation: cleanLocation, maxRedirects: 0 },
      }
    );
    expect(JSON.parse(relative.stdout).locationMatches).toBe(true);
    expect(JSON.parse(relative.stdout)).not.toHaveProperty("location");

    const fragmentLocation = `${cleanLocation}#fragment-only`;
    responseLocation = fragmentLocation;
    const fragment = await run(
      "playwright",
      [
        "--session",
        "request-metadata-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "--no-har",
        "--json",
        "request",
        "get",
        requestUrl,
      ],
      {
        logCommand: false,
        logOutput: false,
        request: { expectedLocation: cleanLocation, maxRedirects: 0 },
      }
    );
    expect(JSON.parse(fragment.stdout).locationMatches).toBe(false);
    expect(JSON.parse(fragment.stdout)).not.toHaveProperty("location");
    expect(fragment.stdout).not.toContain("fragment-only");

    const credentialLocation = cleanLocation.replace(
      "https://",
      "https://username:password@"
    );
    responseLocation = credentialLocation;
    const credentials = await run(
      "playwright",
      [
        "--session",
        "request-metadata-test",
        "--headers",
        JSON.stringify({ "x-vercel-protection-bypass": "test-bypass" }),
        "--no-har",
        "--json",
        "request",
        "get",
        requestUrl,
      ],
      {
        logCommand: false,
        logOutput: false,
        request: { expectedLocation: cleanLocation, maxRedirects: 0 },
      }
    );
    expect(JSON.parse(credentials.stdout).locationMatches).toBe(false);
    expect(JSON.parse(credentials.stdout)).not.toHaveProperty("location");
    expect(credentials.stdout).not.toContain("username");
    expect(credentials.stdout).not.toContain("password");
  } finally {
    await run.close?.();
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

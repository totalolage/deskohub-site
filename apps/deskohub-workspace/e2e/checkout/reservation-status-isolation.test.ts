import "../../shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { browserTextScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { E2EDatabase } from "../integrations/database.service";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutRow } from "../types";
import { assertReservationStatusIsolation } from "./reservation-status-isolation";

const baseUrl = "https://workspace.test";
const orderId = "019f70bd-0131-7f30-9f8a-48e768f00292";
const customerId = "dotypos-customer-paid";
const targetStatusPath = `/en-US/reservation/status/${orderId}`;
const targetStatusUrl = `${baseUrl}${targetStatusPath}`;
const signInUrl = `${baseUrl}/en-US/auth/sign-in?${new URLSearchParams({
  returnTo: targetStatusPath,
  for: "reservation",
})}`;
const originalUrl = `${baseUrl}/en-US/contact?email=${encodeURIComponent(testEmailAddress("synthetic"))}&message=${orderId}`;

const config: WorkspaceE2EConfig = {
  baseUrl,
  bypassSecret: undefined,
  expectedHost: "workspace.test",
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 1_000,
    browserNavigation: 1_000,
    datasource: 1_000,
    uiTransition: 1_000,
  },
};

const targetRow = {
  dotypos_customer_id: customerId,
  fulfillment_state: "failed",
  payment_state: "paid",
  reservation_id: orderId,
} as CheckoutRow;

type IsolationMode =
  | "scoped"
  | "session-reads-every-order"
  | "signed-out-reads-status";

const matchesLocation = (condition: string, url: string): boolean =>
  new Function("location", `return ${condition}`)(new URL(url));

const makeRunner = (mode: IsolationMode) => {
  const calls: Array<{
    readonly command: string;
    readonly options: Parameters<Runner>[2];
    readonly session: string;
  }> = [];
  const outputs: string[] = [];
  const rawBrowserTexts: string[] = [];
  const rawOpenedUrls: string[] = [];
  const waits: Array<{ readonly condition: string; readonly url: string }> = [];

  // The first context is the signed-in booking session; later ones are
  // signed out.
  const makeContext = (signedIn: boolean) => {
    let currentUrl = signedIn ? originalUrl : "about:blank";
    const frame = {
      evaluate: async (input: string) => {
        if (input === browserTextScript) {
          let text = `We couldn't deliver your confirmation. Your payment went through and your reservation is saved, but your confirmation and access link didn't reach your email. Send support request. Order reference ${orderId}.`;
          if (currentUrl.includes("local-reservation-")) {
            text =
              "We could not find this order. Please check the link or start a new reservation.";
          }
          if (currentUrl.includes("/auth/sign-in")) {
            text = "Sign in to see your reservation. Email.";
          }
          rawBrowserTexts.push(text);
          return text;
        }
        if (input.includes('document.querySelectorAll("dd")')) {
          return !currentUrl.includes("local-reservation-");
        }
        if (input.includes("signed-out") || input.includes("innerText")) {
          if (currentUrl.includes("/auth/sign-in")) return true;
        }
        if (input.includes("#checkout-status-support-contact")) {
          return (
            !currentUrl.includes("local-reservation-") ||
            mode !== "session-reads-every-order"
          );
        }
        return true;
      },
      waitForFunction: async (condition: string) => {
        waits.push({ condition, url: currentUrl });
        if (!matchesLocation(condition, currentUrl))
          throw new Error(
            `browser wait condition does not match ${currentUrl}`
          );
        return true;
      },
    };
    const page = {
      goto: async (url: string) => {
        rawOpenedUrls.push(url);
        currentUrl =
          !signedIn &&
          url === targetStatusUrl &&
          mode !== "signed-out-reads-status"
            ? signInUrl
            : url;
      },
      mainFrame: () => frame,
      on: () => undefined,
      url: () => currentUrl,
    };
    return {
      context: {
        close: async () => undefined,
        newPage: async () => page,
        on: () => undefined,
        request: {
          get: async (url: string) => {
            throw new Error(`unexpected browser request: ${url}`);
          },
        },
      },
      currentUrl: () => currentUrl,
    };
  };
  const booking = makeContext(true);
  let contexts = 0;
  const actualRun = makePlaywrightBrowserRunner({
    newContext: async () => {
      contexts += 1;
      return contexts === 1 ? booking.context : makeContext(false).context;
    },
  } as Browser);
  const run: Runner = async (command, args, options) => {
    const session = args[1];
    if (!session) throw new Error("browser session missing");
    const operation = ["request", "get", "open", "wait", "eval", "close"].find(
      (value) => args.includes(value)
    );
    if (!operation)
      throw new Error(`unexpected browser command: ${args.join(" ")}`);
    calls.push({ command: operation, options, session });
    const result = await actualRun(command, args, options);
    outputs.push(result.stdout);
    return result;
  };
  Object.defineProperty(run, "close", {
    enumerable: true,
    value: () => actualRun.close?.(),
  });

  return {
    calls,
    currentUrl: booking.currentUrl,
    outputs,
    rawBrowserTexts,
    rawOpenedUrls,
    run,
    waits,
  };
};

const makeDatabase = () => {
  const rows = new Map<string, unknown>([[orderId, targetRow]]);
  let lastInsertedId: string | undefined;

  const makeSelect = (selection: Record<string, unknown>) => {
    if (Object.hasOwn(selection, "reservation_id")) {
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => ({
          limit: () => Effect.succeed(rows.has(orderId) ? [targetRow] : []),
        }),
      };
      return query;
    }

    return {
      from: () => ({
        where: () =>
          Effect.sync(() =>
            lastInsertedId && rows.has(lastInsertedId)
              ? [{ id: lastInsertedId }]
              : []
          ),
      }),
    };
  };

  const makeTransaction = () => ({
    // The fixture's synthetic reservation author isn't a reservation row.
    insert: (table: unknown) => ({
      values: (row: { readonly id?: string }) =>
        table === customerAccounts
          ? Effect.void
          : Effect.sync(() => {
              if (!row.id) throw new Error("fixture reservation id missing");
              lastInsertedId = row.id;
              rows.set(row.id, row);
            }),
    }),
    select: makeSelect,
  });

  const db = {
    delete: () => ({
      where: () =>
        Effect.sync(() => {
          if (lastInsertedId) rows.delete(lastInsertedId);
        }),
    }),
    insert: () => ({
      values: (row: { readonly id?: string }) =>
        Effect.sync(() => {
          if (!row.id) throw new Error("fixture reservation id missing");
          lastInsertedId = row.id;
          rows.set(row.id, row);
        }),
    }),
    select: makeSelect,
    transaction: (
      use: (transaction: ReturnType<typeof makeTransaction>) => unknown
    ) => use(makeTransaction()),
  };

  return {
    db: db as never,
    hasOnlyTarget: () => rows.size === 1 && rows.has(orderId),
  };
};

const runIsolation = async (mode: IsolationMode = "scoped") => {
  const runner = makeRunner(mode);
  const database = makeDatabase();
  const exit = await Effect.runPromiseExit(
    assertReservationStatusIsolation({
      config,
      customerId: customerId as never,
      data: { locale: "en-US" },
      orderId: orderId as never,
      run: runner.run,
      session: "meeting-room-paid-test",
    }).pipe(Effect.provideService(E2EDatabase, E2EDatabase.of(database)))
  ).finally(() => runner.run.close?.());

  return { database, exit, runner };
};

test("checks target authorization, other-order isolation, and signed-out sign-in", async () => {
  const result = await runIsolation();

  expect(result.exit._tag).toBe("Success");
  expect(new Set(result.runner.calls.map(({ session }) => session))).toEqual(
    new Set(["meeting-room-paid-test", "meeting-room-paid-test-signed-out"])
  );
  expect(
    result.runner.calls.some(
      ({ command, session }) =>
        command === "close" && session === "meeting-room-paid-test-signed-out"
    )
  ).toBe(true);
  expect(result.runner.waits.some(({ url }) => url === signInUrl)).toBe(true);
  expect(result.runner.calls.some(({ command }) => command === "request")).toBe(
    false
  );
  expect(result.runner.currentUrl()).toBe(`${baseUrl}/en-US/contact`);
  expect(result.database.hasOnlyTarget()).toBe(true);
  expect(
    result.runner.rawBrowserTexts.some((text) => text.includes(orderId))
  ).toBe(true);
  expect(result.runner.rawOpenedUrls).toContain(targetStatusUrl);
  expect(
    result.runner.outputs.every(
      (output) => !output.includes(orderId) && !output.includes(targetStatusUrl)
    )
  ).toBe(true);
  const contactWaits = result.runner.waits.filter(
    ({ url }) => new URL(url).pathname === "/en-US/contact"
  );
  const exactWaits = result.runner.waits.filter(({ url }) => {
    const { pathname } = new URL(url);
    return pathname !== "/en-US/contact" && pathname !== "/en-US/auth/sign-in";
  });
  expect(contactWaits.length).toBeGreaterThan(0);
  expect(exactWaits.length).toBeGreaterThan(0);
  for (const { condition } of contactWaits) {
    // The support link carries the email and message in the query string.
    expect(matchesLocation(condition, originalUrl)).toBe(true);
    expect(matchesLocation(condition, `${baseUrl}/en-US/contact#form`)).toBe(
      false
    );
    expect(matchesLocation(condition, "https://other.test/en-US/contact")).toBe(
      false
    );
  }
  for (const { condition, url } of exactWaits) {
    expect(matchesLocation(condition, `${url}?unexpected=1`)).toBe(false);
    expect(matchesLocation(condition, `${url}#other`)).toBe(false);
  }
});

test("fails when the booking session reads every order", async () => {
  const result = await runIsolation("session-reads-every-order");

  expect(result.exit._tag).toBe("Failure");
  expect(String(result.exit)).toContain(
    "other reservation details were exposed to the booking session"
  );
  expect(result.runner.currentUrl()).toBe(`${baseUrl}/en-US/contact`);
  expect(result.database.hasOnlyTarget()).toBe(true);
});

test("fails when a signed-out visitor reads the status page", async () => {
  const result = await runIsolation("signed-out-reads-status");

  expect(result.exit._tag).toBe("Failure");
  expect(String(result.exit)).toContain(
    "signed-out reservation status sign-in URL"
  );
  expect(result.runner.currentUrl()).toBe(`${baseUrl}/en-US/contact`);
  expect(result.database.hasOnlyTarget()).toBe(true);
});

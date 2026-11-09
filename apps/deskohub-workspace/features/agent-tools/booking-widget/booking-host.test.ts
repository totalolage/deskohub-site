import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type {
  App,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { Cause, Effect, Exit, Option } from "effect";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ListOfferingsResult } from "../list-offerings.schema";
import {
  type BookingHost,
  BookingRequestFailed,
  BookingToolFailed,
  connectBookingHost,
} from "./booking-host";
import {
  bookingOfferings,
  bookingToday,
  showBookingResult,
} from "./booking-widget.test-utils";

registerWorkspaceComponentTestEnv();

afterAll(unregisterWorkspaceComponentTestEnv);

type ToolCall = Parameters<App["callServerTool"]>[0];
type ToolResult = Awaited<ReturnType<App["callServerTool"]>>;
type ToolInput = Parameters<NonNullable<App["ontoolinput"]>>[0];
type ChatGptBridge = NonNullable<Window["openai"]>;

const backgroundVariable = "--color-background-primary";

const toolResult = (
  structuredContent: ToolResult["structuredContent"],
  isError = false
): ToolResult => ({ content: [], structuredContent, isError });

const listOfferingsResult = (): ListOfferingsResult => ({
  business: {
    name: "Deskohub Workspace",
    address: "Synthetic street 1",
    opening_hours: "Mon–Fri",
    booking: "Online",
  },
  advertised_on: "2099-08-01",
  offerings: bookingOfferings().slice(0, 1),
});

/**
 * An MCP Apps host the view connects to, recording the calls the view makes
 * through it.
 */
const fakeHost = ({
  context,
  capabilities,
  connect = () => Promise.resolve(),
  tools = {},
  link = "opened",
}: {
  readonly context?: McpUiHostContext;
  readonly capabilities?: McpUiHostCapabilities;
  readonly connect?: () => Promise<void>;
  readonly tools?: Readonly<Record<string, ToolResult>>;
  readonly link?: "opened" | "refused" | "unreachable";
} = {}) => {
  const calls = {
    tools: [] as Array<ToolCall>,
    links: [] as Array<string>,
    closed: 0,
  };
  const app = {
    ontoolinput: undefined as ((input: ToolInput) => void) | undefined,
    ontoolresult: undefined as ((result: ToolResult) => void) | undefined,
    onhostcontextchanged: undefined as
      | ((context: McpUiHostContext) => void)
      | undefined,
    connect,
    close: () => {
      calls.closed += 1;
      return Promise.resolve();
    },
    getHostContext: () => context,
    getHostCapabilities: () => capabilities,
    callServerTool: (call: ToolCall) => {
      calls.tools.push(call);
      const result = tools[call.name];
      return result
        ? Promise.resolve(result)
        : Promise.reject(new Error(`No ${call.name} result`));
    },
    openLink: ({ url }: { readonly url: string }) => {
      calls.links.push(url);
      return link === "unreachable"
        ? Promise.reject(new Error("Host unreachable"))
        : Promise.resolve({ isError: link === "refused" });
    },
  };
  return { app, calls };
};

type FakeHost = ReturnType<typeof fakeHost>;

const withHost = <A, E>(
  { app }: FakeHost,
  use: (host: BookingHost["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromiseExit(
    Effect.scoped(connectBookingHost(app).pipe(Effect.flatMap(use)))
  );

const succeeded = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
};

const failure = <A, E>(exit: Exit.Exit<A, E>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  return Exit.isFailure(exit)
    ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
    : undefined;
};

const setChatGptBridge = (bridge: Partial<ChatGptBridge> | undefined) =>
  Object.defineProperty(window, "openai", {
    configurable: true,
    writable: true,
    value: bridge,
  });

const documentTheme = () => document.documentElement.getAttribute("data-theme");

const announceChatGptGlobals = () =>
  window.dispatchEvent(new Event("openai:set_globals"));

afterEach(() => {
  setChatGptBridge(undefined);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

describe("connectBookingHost", () => {
  test("fails with a request failure when the host won't connect, and connects nothing", async () => {
    const host = fakeHost({
      connect: () => Promise.reject(new Error("refused")),
    });

    const error = failure(await withHost(host, () => Effect.void));

    expect(error).toBeInstanceOf(BookingRequestFailed);
    expect(host.calls.closed).toBe(0);
  });

  test("closes the host connection when the view's scope ends", async () => {
    const host = fakeHost();

    succeeded(await withHost(host, () => Effect.void));

    expect(host.calls.closed).toBe(1);
  });
});

describe("host styles", () => {
  test("follows the host's theme and style variables on connect", async () => {
    const host = fakeHost({
      context: {
        theme: "dark",
        styles: { variables: { [backgroundVariable]: "#101010" } },
      },
    });

    succeeded(await withHost(host, () => Effect.void));

    expect(documentTheme()).toBe("dark");
    expect(
      document.documentElement.style.getPropertyValue(backgroundVariable)
    ).toBe("#101010");
  });

  test("leaves the document alone when the host context has no look", async () => {
    succeeded(await withHost(fakeHost(), () => Effect.void));

    expect(documentTheme()).toBeNull();
    expect(
      document.documentElement.style.getPropertyValue(backgroundVariable)
    ).toBe("");
  });

  test("applies only the fields a context update carries", async () => {
    const host = fakeHost({ context: { theme: "light" } });

    succeeded(
      await withHost(host, () =>
        Effect.sync(() => {
          host.app.onhostcontextchanged?.({
            styles: { variables: { [backgroundVariable]: "#fafafa" } },
          });
          expect(documentTheme()).toBe("light");
          host.app.onhostcontextchanged?.({ theme: "dark" });
        })
      )
    );

    expect(documentTheme()).toBe("dark");
    expect(
      document.documentElement.style.getPropertyValue(backgroundVariable)
    ).toBe("#fafafa");
  });
});

describe("ChatGPT theme", () => {
  test("takes the bridge's theme when the host context has none, and follows its changes", async () => {
    const bridge = { theme: "dark" as const, openExternal: () => undefined };
    setChatGptBridge(bridge);

    succeeded(
      await withHost(fakeHost(), () =>
        Effect.sync(() => {
          expect(documentTheme()).toBe("dark");
          setChatGptBridge({ ...bridge, theme: "light" });
          announceChatGptGlobals();
        })
      )
    );

    expect(documentTheme()).toBe("light");
  });

  test("stops following the bridge once the view's scope ends", async () => {
    setChatGptBridge({ theme: "light", openExternal: () => undefined });

    succeeded(await withHost(fakeHost(), () => Effect.void));
    setChatGptBridge({ theme: "dark", openExternal: () => undefined });
    announceChatGptGlobals();

    expect(documentTheme()).toBe("light");
  });

  test("keeps the host context's theme over the bridge's", async () => {
    setChatGptBridge({ theme: "dark", openExternal: () => undefined });

    succeeded(
      await withHost(fakeHost({ context: { theme: "light" } }), () =>
        Effect.sync(announceChatGptGlobals)
      )
    );

    expect(documentTheme()).toBe("light");
  });

  test("leaves the theme alone when the bridge reports none", async () => {
    setChatGptBridge({ openExternal: () => undefined });

    succeeded(await withHost(fakeHost(), () => Effect.void));

    expect(documentTheme()).toBeNull();
  });
});

describe("locale", () => {
  const localeAfter = async (
    host: FakeHost,
    deliver: (app: FakeHost["app"]) => void
  ) =>
    succeeded(
      await withHost(host, ({ locale }) =>
        Effect.sync(() => deliver(host.app)).pipe(Effect.andThen(locale))
      )
    );

  test("takes the language the tool call requested", async () => {
    const locale = await localeAfter(
      fakeHost({ context: { locale: "en-GB" } }),
      (app) => app.ontoolinput?.({ arguments: { locale: "cs-CZ" } })
    );

    expect(locale).toBe("cs-CZ");
  });

  test("falls back to the host's language when the call requests none or an unknown one", async () => {
    const withoutRequest = await localeAfter(
      fakeHost({ context: { locale: "cs" } }),
      (app) => app.ontoolinput?.({ arguments: {} })
    );
    const withUnknown = await localeAfter(
      fakeHost({ context: { locale: "cs-CZ" } }),
      (app) => app.ontoolinput?.({ arguments: { locale: "fr-FR" } })
    );

    expect(withoutRequest).toBe("cs-CZ");
    expect(withUnknown).toBe("cs-CZ");
  });

  test("is known from the result alone when the host sends no arguments", async () => {
    const locale = await localeAfter(fakeHost(), (app) =>
      app.ontoolresult?.(
        toolResult(showBookingResult({ mode: "reserve", locale: "en-US" }))
      )
    );

    expect(locale).toBe("en-US");
  });

  test("takes ChatGPT's language when the host context has none", async () => {
    setChatGptBridge({ locale: "cs-CZ", openExternal: () => undefined });

    const locale = await localeAfter(fakeHost(), (app) =>
      app.ontoolinput?.({})
    );

    expect(locale).toBe("cs-CZ");
  });
});

describe("start", () => {
  const startAfter = async (
    host: FakeHost,
    result: ToolResult,
    input: ToolInput = {}
  ) =>
    withHost(host, ({ start }) =>
      Effect.sync(() => {
        host.app.ontoolinput?.(input);
        host.app.ontoolresult?.(result);
      }).pipe(Effect.andThen(start))
    );

  test("renders the result as is when it's in the view's language", async () => {
    const host = fakeHost({ capabilities: { openLinks: {} } });
    const result = showBookingResult({
      mode: "reservation_page",
      locale: "en-US",
      selection: { family: "cowork" },
    });

    const start = succeeded(await startAfter(host, toolResult(result)));

    expect(start).toEqual({
      locale: "en-US",
      mode: "reservation_page",
      today: bookingToday,
      offerings: result.offerings,
      selection: { family: "cowork" },
      opensLinks: true,
    });
    expect(host.calls.tools).toEqual([]);
  });

  test("lists the offerings again in the view's language when the result's differs", async () => {
    const listing = listOfferingsResult();
    const host = fakeHost({
      tools: { list_offerings: toolResult(listing) },
    });

    const start = succeeded(
      await startAfter(
        host,
        toolResult(showBookingResult({ mode: "reserve", locale: "en-US" })),
        { arguments: { locale: "cs-CZ" } }
      )
    );

    expect(host.calls.tools).toEqual([
      { name: "list_offerings", arguments: { locale: "cs-CZ" } },
    ]);
    expect(start.locale).toBe("cs-CZ");
    expect(start.today).toBe(listing.advertised_on);
    expect(start.offerings).toEqual(listing.offerings);
  });

  test("opens links through ChatGPT's bridge when the host declares none", async () => {
    setChatGptBridge({ openExternal: () => undefined });
    const result = toolResult(
      showBookingResult({ mode: "reserve", locale: "en-US" })
    );

    const withBridge = succeeded(await startAfter(fakeHost(), result));
    setChatGptBridge(undefined);
    const withoutEither = succeeded(await startAfter(fakeHost(), result));

    expect(withBridge.opensLinks).toBe(true);
    expect(withoutEither.opensLinks).toBe(false);
  });

  test("fails with the tool's error when show_booking failed", async () => {
    const error = {
      code: "offerings_unavailable",
      message: "Offerings are unavailable.",
    } as const;

    const failed = failure(
      await startAfter(fakeHost(), toolResult({ error }, true))
    );

    expect(failed).toEqual(new BookingToolFailed({ error }));
  });

  test("fails with a request failure when the result or its error is unreadable", async () => {
    const unreadableResult = failure(
      await startAfter(fakeHost(), toolResult({ locale: "en-US" }))
    );
    const unreadableError = failure(
      await startAfter(fakeHost(), toolResult({ error: "boom" }, true))
    );

    expect(unreadableResult).toBeInstanceOf(BookingRequestFailed);
    expect(unreadableError).toBeInstanceOf(BookingRequestFailed);
  });

  test("fails with a request failure when the host can't carry the listing call", async () => {
    const failed = failure(
      await startAfter(
        fakeHost(),
        toolResult(showBookingResult({ mode: "reserve", locale: "en-US" })),
        { arguments: { locale: "cs-CZ" } }
      )
    );

    expect(failed).toBeInstanceOf(BookingRequestFailed);
  });
});

describe("openLink", () => {
  const url = "https://workspace.deskohub.test/reservation/cowork";

  test("opens the link through the host when it declares openLinks", async () => {
    const host = fakeHost({ capabilities: { openLinks: {} } });
    const opened: Array<string> = [];
    setChatGptBridge({ openExternal: ({ href }) => void opened.push(href) });

    succeeded(await withHost(host, ({ openLink }) => openLink(url)));

    expect(host.calls.links).toEqual([url]);
    expect(opened).toEqual([]);
  });

  test("fails when the host refuses or can't carry the link", async () => {
    const outcomes = await Promise.all(
      (["refused", "unreachable"] as const).map(async (link) =>
        failure(
          await withHost(
            fakeHost({ capabilities: { openLinks: {} }, link }),
            ({ openLink }) => openLink(url)
          )
        )
      )
    );

    expect(outcomes).toEqual([
      expect.objectContaining({ _tag: "BookingLinkNotOpened" }),
      expect.objectContaining({ _tag: "BookingLinkNotOpened" }),
    ]);
  });

  test("opens the link as is through ChatGPT's bridge when the host declares no openLinks", async () => {
    const host = fakeHost();
    const opened: Array<unknown> = [];
    setChatGptBridge({ openExternal: (options) => void opened.push(options) });

    succeeded(await withHost(host, ({ openLink }) => openLink(url)));

    expect(opened).toEqual([{ href: url, redirectUrl: false }]);
    expect(host.calls.links).toEqual([]);
  });

  test("fails when ChatGPT's bridge can't open the link", async () => {
    setChatGptBridge({
      openExternal: () => Promise.reject(new Error("blocked")),
    });

    const error = failure(
      await withHost(fakeHost(), ({ openLink }) => openLink(url))
    );

    expect(error).toMatchObject({ _tag: "BookingLinkNotOpened" });
  });

  test("fails when neither the host nor ChatGPT can open links", async () => {
    const error = failure(
      await withHost(fakeHost(), ({ openLink }) => openLink(url))
    );

    expect(error).toMatchObject({ _tag: "BookingLinkNotOpened" });
  });
});

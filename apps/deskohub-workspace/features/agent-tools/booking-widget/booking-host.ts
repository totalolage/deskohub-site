import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { Context, Data, Deferred, Effect, Layer, Option, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import {
  type AgentToolErrorResult,
  agentToolErrorResultSchema,
} from "../agent-tool-error";
import {
  type ListOfferingsResult,
  listOfferingsResultSchema,
} from "../list-offerings.schema";
import { showBookingResultSchema } from "../show-booking.schema";
import { type BookingStart, getBookingLocale } from "./booking-draft";

/**
 * A tool answered with its own error. The view words it from the code: the
 * tool's `message` is written for the agent.
 */
export class BookingToolFailed extends Data.TaggedError("BookingToolFailed")<{
  readonly error: AgentToolErrorResult["error"];
}> {}

/** The host couldn't carry the request, or answered with something unreadable. */
export class BookingRequestFailed extends Data.TaggedError(
  "BookingRequestFailed"
)<{ readonly cause?: unknown }> {}

/** The host didn't open a link. */
class BookingLinkNotOpened extends Data.TaggedError("BookingLinkNotOpened")<{
  readonly cause?: unknown;
}> {}

type ToolResult = Awaited<ReturnType<App["callServerTool"]>>;

type ToolInput = Parameters<NonNullable<App["ontoolinput"]>>[0];

type ResultSchema<A> = Schema.Codec<A, unknown> & {
  readonly DecodingServices: never;
};

/**
 * The MCP Apps host the booking view runs in. Every tool call goes through
 * the host's `tools/call`, which runs it on this server with the agent's
 * grant; the view never fetches `/api/mcp` itself.
 */
export class BookingHost extends Context.Service<
  BookingHost,
  {
    /**
     * The view's language, known once the host sends the `show_booking`
     * result, whether or not the view can start from it.
     */
    readonly locale: Effect.Effect<Locale>;
    /** The `show_booking` result the view renders, in the view's language. */
    readonly start: Effect.Effect<
      BookingStart,
      BookingToolFailed | BookingRequestFailed
    >;
    readonly callTool: <A>(
      name: string,
      args: Schema.JsonObject,
      result: ResultSchema<A>
    ) => Effect.Effect<A, BookingToolFailed | BookingRequestFailed>;
    /** Opens a site page in the customer's browser, through the host. */
    readonly openLink: (
      url: string
    ) => Effect.Effect<void, BookingLinkNotOpened>;
  }
>()("@deskohub-workspace/agent-tools/BookingHost") {
  static readonly Live = Layer.effect(
    BookingHost,
    Effect.suspend(() => connectBookingHost(new App(viewInfo, {})))
  );
}

const viewInfo = { name: "dh-workspace-booking", version: "1.0.0" };

const toolInputSchema = Schema.Struct({
  locale: Schema.optionalKey(Schema.Literals(locales)),
});

/**
 * A tool result's structured content, decoded with the tool's published
 * schema; an error result fails with the tool's error.
 */
const decodeToolResult =
  <A>(schema: ResultSchema<A>) =>
  (result: ToolResult) =>
    result.isError
      ? Schema.decodeUnknownEffect(agentToolErrorResultSchema)(
          result.structuredContent
        ).pipe(
          Effect.mapError((cause) => new BookingRequestFailed({ cause })),
          Effect.flatMap(({ error }) =>
            Effect.fail(new BookingToolFailed({ error }))
          )
        )
      : Schema.decodeUnknownEffect(schema)(result.structuredContent).pipe(
          Effect.mapError((cause) => new BookingRequestFailed({ cause }))
        );

/**
 * Follows the host's look: its theme and the style variables the view's
 * colours and font come from. A context update carries only the fields that
 * changed. The view skips the host's font CSS: its sandbox admits no
 * resource domains, so the font stack falls back to system fonts.
 */
const applyHostStyles = ({ theme, styles }: McpUiHostContext) => {
  if (theme) applyDocumentTheme(theme);
  if (styles?.variables) applyHostStyleVariables(styles.variables);
};

const connectBookingHost = Effect.fn("bookingWidget.connect")(function* (
  app: App
) {
  const toolInput = yield* Deferred.make<ToolInput>();
  const toolResult = yield* Deferred.make<ToolResult>();
  // The host sends the call's arguments, then its result, once the view
  // has connected; the handlers must be in place before it does.
  app.ontoolinput = (input) =>
    Deferred.doneUnsafe(toolInput, Effect.succeed(input));
  app.ontoolresult = (result) =>
    Deferred.doneUnsafe(toolResult, Effect.succeed(result));
  app.onhostcontextchanged = applyHostStyles;
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => app.connect(),
      catch: (cause) => new BookingRequestFailed({ cause }),
    }),
    () => Effect.promise(() => app.close())
  );
  yield* Effect.sync(() => applyHostStyles(app.getHostContext() ?? {}));
  // ChatGPT may report its theme only through its own bridge, which
  // announces a change with `openai:set_globals`. The host context's theme
  // comes first.
  const followChatGptTheme = () => {
    const theme = window.openai?.theme;
    if (theme && !app.getHostContext()?.theme) applyDocumentTheme(theme);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      followChatGptTheme();
      window.addEventListener("openai:set_globals", followChatGptTheme);
    }),
    () =>
      Effect.sync(() =>
        window.removeEventListener("openai:set_globals", followChatGptTheme)
      )
  );

  const callTool = <A>(
    name: string,
    args: Schema.JsonObject,
    schema: ResultSchema<A>
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        app.callServerTool({ name, arguments: args }, { signal }),
      catch: (cause) => new BookingRequestFailed({ cause }),
    }).pipe(Effect.flatMap(decodeToolResult(schema)));

  // Hosts send the arguments before the result, if at all, so the language
  // is known once either arrives.
  const locale = Effect.raceFirst(
    Deferred.await(toolInput),
    Deferred.await(toolResult)
  ).pipe(
    Effect.andThen(Deferred.poll(toolInput)),
    Effect.flatMap(Effect.transposeOption),
    Effect.map((input) =>
      getBookingLocale({
        requested: Option.getOrUndefined(
          Option.flatMap(input, ({ arguments: args }) =>
            Schema.decodeUnknownOption(toolInputSchema)(args)
          )
        )?.locale,
        hostLocale: app.getHostContext()?.locale ?? window.openai?.locale,
      })
    )
  );

  const start = Effect.Do.pipe(
    Effect.bind("result", () =>
      Deferred.await(toolResult).pipe(
        Effect.flatMap(decodeToolResult(showBookingResultSchema))
      )
    ),
    Effect.bind("locale", () => locale),
    // Offering names come in the result's language; a view in another
    // language lists them again in its own.
    Effect.bind(
      "listing",
      ({
        result,
        locale,
      }): Effect.Effect<
        Pick<ListOfferingsResult, "advertised_on" | "offerings">,
        BookingToolFailed | BookingRequestFailed
      > =>
        result.locale === locale
          ? Effect.succeed(result)
          : callTool("list_offerings", { locale }, listOfferingsResultSchema)
    ),
    Effect.map(
      ({ result, locale, listing }): BookingStart => ({
        locale,
        mode: result.booking_mode,
        today: listing.advertised_on,
        offerings: listing.offerings,
        selection: result.selection,
        opensLinks: Boolean(
          app.getHostCapabilities()?.openLinks ?? window.openai
        ),
      })
    )
  );

  const openLink = (url: string) =>
    Effect.suspend(() => {
      if (app.getHostCapabilities()?.openLinks) {
        return Effect.tryPromise({
          try: () => app.openLink({ url }),
          catch: (cause) => new BookingLinkNotOpened({ cause }),
        }).pipe(
          Effect.filterOrFail(
            ({ isError }) => !isError,
            () => new BookingLinkNotOpened({})
          ),
          Effect.asVoid
        );
      }
      // ChatGPT's own bridge opens links when the host doesn't declare
      // `openLinks`.
      return Option.match(Option.fromNullishOr(window.openai), {
        onNone: () => Effect.fail(new BookingLinkNotOpened({})),
        onSome: (openai) =>
          Effect.tryPromise({
            try: async () =>
              openai.openExternal({ href: url, redirectUrl: false }),
            catch: (cause) => new BookingLinkNotOpened({ cause }),
          }),
      });
    });

  return BookingHost.of({ locale, start, callTool, openLink });
});

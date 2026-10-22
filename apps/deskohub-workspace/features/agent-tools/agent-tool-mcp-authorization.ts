import { Data, Effect, Match, Option, Schema } from "effect";
import {
  CustomerAgentAuthorization,
  type CustomerAgentAuthorizationError,
  type CustomerAgentChallengeReason,
  customerAgentChallenge,
  readAgentAccessToken,
} from "@/features/account";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import type { AgentToolAuthorization } from "./agent-tool";
import type { CustomerAgentCaller } from "./customer-agent-caller";

/**
 * The request was refused before the MCP server saw it, with an OAuth
 * challenge telling the agent how to get a usable token.
 */
export class AgentToolRequestRefused extends Data.TaggedError(
  "AgentToolRequestRefused"
)<{ readonly response: Response }> {}

/** What authorizing a request needs to know about a published tool. */
type PublishedTool = AgentToolAuthorization & { readonly name: string };

/**
 * Authorizes an MCP request at the HTTP layer, where OAuth challenges must
 * be answered: a tool result can't carry a 401. A request with a bearer
 * token is served only if the token grants something; a call of a signed-in
 * tool needs a token with the tool's scope. Public tools and every other
 * method stay open without a token. An authorization server that can't be
 * reached fails the request.
 *
 * `callerTools` adds the tools only this caller may see, once its token is
 * verified; a call is checked against `tools` and those alike. Returns the
 * caller and every tool the request is served with.
 */
export const authorizeAgentToolRequest = <
  Tool extends PublishedTool,
  E = never,
  R = never,
>({
  tools,
  callerTools,
  request,
}: {
  readonly tools: ReadonlyArray<Tool>;
  readonly callerTools?:
    | ((
        caller: Option.Option<CustomerAgentCaller>
      ) => Effect.Effect<ReadonlyArray<Tool>, E, R>)
    | undefined;
  readonly request: Request;
}) =>
  authorizeBearerToken(request).pipe(
    Effect.flatMap((caller) =>
      (callerTools === undefined
        ? Effect.succeed<ReadonlyArray<Tool>>([])
        : callerTools(caller)
      ).pipe(
        Effect.map((added) => [...tools, ...added]),
        Effect.tap((served) =>
          authorizeCalledTools({ tools: served, request, caller })
        ),
        Effect.map((served) => ({ caller, tools: served }))
      )
    ),
    Effect.withSpan("agentTools.authorizeRequest")
  );

/** Refuses a call of a tool the caller's token doesn't grant. */
const authorizeCalledTools = Effect.fn("agentTools.authorizeCalledTools")(
  function* ({
    tools,
    request,
    caller,
  }: {
    readonly tools: ReadonlyArray<PublishedTool>;
    readonly request: Request;
    readonly caller: Option.Option<CustomerAgentCaller>;
  }) {
    const calledTools = yield* readCalledTools({ tools, request });
    yield* Effect.forEach(calledTools, (tool) =>
      Match.value<AgentToolAuthorization>(tool).pipe(
        Match.discriminatorsExhaustive("access")({
          public: () => Effect.void,
          "signed-in": ({ scope }) =>
            Option.match(caller, {
              onNone: () => refuse({ kind: "missing-token", scopes: [scope] }),
              onSome: ({ grant }) =>
                Effect.when(
                  refuse({ kind: "insufficient-scope", scopes: [scope] }),
                  Effect.sync(() => !grant.scopes.has(scope))
                ),
            }),
          // Listed only after the live administrator check, so a caller
          // reaches this only with the scope; the tool re-checks the grant.
          administration: () =>
            Effect.when(
              refuse({ kind: "invalid-token" }),
              Effect.sync(
                () =>
                  !Option.exists(caller, ({ grant }) =>
                    grant.scopes.has(administrationAgentScope)
                  )
              )
            ),
        })
      )
    );
  }
);

/**
 * Whether the caller may call the tool: any caller a public one, and an
 * agent whose token grants its scope a signed-in one.
 */
export const isAgentToolGranted = (
  tool: AgentToolAuthorization,
  caller: Option.Option<CustomerAgentCaller>
) =>
  Match.value(tool).pipe(
    Match.discriminatorsExhaustive("access")({
      public: () => true,
      "signed-in": ({ scope }) =>
        Option.exists(caller, ({ grant }) => grant.scopes.has(scope)),
      administration: () =>
        Option.exists(caller, ({ grant }) =>
          grant.scopes.has(administrationAgentScope)
        ),
    })
  );

/** The caller behind the request's bearer token, if it sent one. */
const authorizeBearerToken = (request: Request) =>
  Option.match(readAgentAccessToken(request.headers), {
    onNone: () => Effect.succeed(Option.none<CustomerAgentCaller>()),
    onSome: (accessToken) =>
      CustomerAgentAuthorization.pipe(
        Effect.flatMap((authorization) => authorization.authorize(accessToken)),
        Effect.map((grant) => Option.some({ grant, accessToken })),
        // An unreachable authorization server fails the request; a token
        // that grants nothing gets an invalid_token challenge.
        Effect.catchIf(
          (error) => error.reason !== "unavailable",
          (error: CustomerAgentAuthorizationError) =>
            Effect.logInfo("Agent access token was refused", {
              reason: error.reason,
            }).pipe(Effect.andThen(refuse({ kind: "invalid-token" })))
        )
      ),
  });

const refuse = (reason: CustomerAgentChallengeReason) =>
  customerAgentChallenge(reason).pipe(
    Effect.flatMap(({ status, headers }) =>
      Effect.fail(
        new AgentToolRequestRefused({
          response: new Response(null, {
            status,
            headers: { ...headers, "cache-control": "no-store" },
          }),
        })
      )
    )
  );

const toolCallMessageSchema = Schema.Struct({
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({ name: Schema.String }),
});

const decodeToolCall = Schema.decodeUnknownOption(toolCallMessageSchema);

/**
 * The published tools the request's JSON-RPC message, or batch, calls. A
 * body that isn't JSON calls none; the MCP server answers it.
 */
const readCalledTools = ({
  tools,
  request,
}: {
  readonly tools: ReadonlyArray<PublishedTool>;
  readonly request: Request;
}) =>
  Effect.tryPromise(() => request.clone().json() as Promise<unknown>).pipe(
    Effect.orElseSucceed(() => null),
    Effect.map((body) =>
      (Array.isArray(body) ? body : [body]).flatMap((message) =>
        Option.match(decodeToolCall(message), {
          onNone: () => [],
          onSome: ({ params }) =>
            tools.filter((tool) => tool.name === params.name),
        })
      )
    )
  );

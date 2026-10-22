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
import { readMcpMessages } from "./agent-tool-mcp-messages";
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
 * A refused tool call also gets an error result for each call in the body,
 * carrying the challenge in `_meta["mcp/www_authenticate"]`, the form
 * ChatGPT reads to offer signing in for one tool.
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
  readToolCalls(request).pipe(
    Effect.flatMap((toolCalls) => {
      const refuse = (reason: CustomerAgentChallengeReason) =>
        refuseRequest(reason, toolCalls);
      return authorizeBearerToken(request, refuse).pipe(
        Effect.flatMap((caller) =>
          (callerTools === undefined
            ? Effect.succeed<ReadonlyArray<Tool>>([])
            : callerTools(caller)
          ).pipe(
            Effect.map((added) => [...tools, ...added]),
            Effect.tap((served) =>
              authorizeCalledTools({ tools: served, toolCalls, caller, refuse })
            ),
            Effect.map((served) => ({ caller, tools: served }))
          )
        )
      );
    }),
    Effect.withSpan("agentTools.authorizeRequest")
  );

/** Refuses a call of a tool the caller's token doesn't grant. */
const authorizeCalledTools = Effect.fn("agentTools.authorizeCalledTools")(
  function* ({
    tools,
    toolCalls,
    caller,
    refuse,
  }: {
    readonly tools: ReadonlyArray<PublishedTool>;
    readonly toolCalls: ReadonlyArray<ToolCallMessage>;
    readonly caller: Option.Option<CustomerAgentCaller>;
    readonly refuse: (
      reason: CustomerAgentChallengeReason
    ) => Effect.Effect<never, AgentToolRequestRefused>;
  }) {
    const calledTools = toolCalls.flatMap(({ params }) =>
      tools.filter((tool) => tool.name === params.name)
    );
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
          // Never challenged: an OAuth challenge naming `administration`
          // would send a customer's agent, whose consent drops the scope,
          // into a re-authorization loop. The tools are listed only after
          // the live administrator check, and each call re-checks the grant
          // and answers a refusal as a tool error.
          administration: () => Effect.void,
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
const authorizeBearerToken = (
  request: Request,
  refuse: (
    reason: CustomerAgentChallengeReason
  ) => Effect.Effect<never, AgentToolRequestRefused>
) =>
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

const refuseRequest = (
  reason: CustomerAgentChallengeReason,
  toolCalls: ReadonlyArray<ToolCallMessage>
) =>
  customerAgentChallenge(reason).pipe(
    Effect.flatMap(({ status, headers }) =>
      Effect.fail(
        new AgentToolRequestRefused({
          response: new Response(
            toolCalls.length === 0
              ? null
              : JSON.stringify(
                  getChallengeResults(toolCalls, headers["WWW-Authenticate"])
                ),
            {
              status,
              headers: {
                ...headers,
                "cache-control": "no-store",
                ...(toolCalls.length > 0 && {
                  "content-type": "application/json",
                }),
              },
            }
          ),
        })
      )
    )
  );

/**
 * A JSON-RPC error result for each refused call, or for the one call of a
 * single-message body. ChatGPT asks for `error` and `error_description` in
 * the challenge; a missing token's challenge names neither, so they are
 * added there.
 */
const getChallengeResults = (
  toolCalls: ReadonlyArray<ToolCallMessage>,
  challenge: string
) => {
  const withError = challenge.includes("error=")
    ? challenge
    : `${challenge}, error="insufficient_scope"`;
  const toolChallenge = withError.includes("error_description=")
    ? withError
    : `${withError}, error_description="Sign in to use this tool"`;
  const results = toolCalls.map(({ id }) => ({
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: "Sign in to use this tool." }],
      _meta: { "mcp/www_authenticate": [toolChallenge] },
    },
  }));
  return results.length === 1 ? results[0] : results;
};

const toolCallMessageSchema = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({ name: Schema.String }),
});

type ToolCallMessage = typeof toolCallMessageSchema.Type;

const decodeToolCall = Schema.decodeUnknownOption(toolCallMessageSchema);

/** The tool calls in the request's JSON-RPC message, or batch. */
const readToolCalls = (request: Request) =>
  readMcpMessages(request).pipe(
    Effect.map((messages) =>
      messages.flatMap((message) => Option.toArray(decodeToolCall(message)))
    )
  );

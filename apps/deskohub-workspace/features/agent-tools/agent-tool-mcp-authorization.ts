import { Data, Effect, Match, Option, Schema } from "effect";
import {
  CustomerAgentAuthorization,
  type CustomerAgentAuthorizationError,
  type CustomerAgentChallengeReason,
  customerAgentChallenge,
  readAgentAccessToken,
} from "@/features/account";
import type { AgentToolAuthorization } from "./agent-tool";
import type { CustomerAgentCaller } from "./customer-agent-caller";

/**
 * The request was refused before the MCP server saw it, with an OAuth
 * challenge telling the agent how to get a usable token.
 */
class AgentToolRequestRefused extends Data.TaggedError(
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
 */
export const authorizeAgentToolRequest = Effect.fn(
  "agentTools.authorizeRequest"
)(function* ({
  tools,
  request,
}: {
  readonly tools: ReadonlyArray<PublishedTool>;
  readonly request: Request;
}) {
  const caller = yield* authorizeBearerToken(request);
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
      })
    )
  );

  return caller;
});

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

import { equal, fail } from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type Client,
  ProtocolError,
  ProtocolErrorCode,
  type Tool,
} from "@modelcontextprotocol/client";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { Effect } from "effect";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";
import { m } from "@/features/i18n";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import { getConfig, type WorkspaceE2EConfig } from "../config";
import {
  administrationAgentRequestedScopes,
  type CustomerAgentRequestedScope,
  isCustomerAgentCallbackUrl,
  isCustomerAgentConsentUrl,
  localizeCustomerAgentConsentUrl,
  readCustomerAgentCallback,
} from "../customer-agent/authorization";
import {
  type CustomerAgentAuthorizationServer,
  connectCustomerMcp,
  discoverCustomerAgentAuthorization,
  exchangeCustomerAgentCode,
  startCustomerAgentAuthorization,
} from "../customer-agent/mcp";
import { tryWorkspaceE2EPromise, tryWorkspaceE2ESync } from "../errors";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { waitForReactClickHandler } from "../react-handlers";
import { addRedaction, assert, parseUrl, workspaceDir } from "../runtime";
import {
  workspaceE2EAdministratorAgentToolsPlaywrightTimeout,
  workspaceE2ETimeouts,
} from "../timeouts";
import { runAdministratorCase } from "./administrator-case";
import { makeWorkspaceE2EAdministrationIdentities } from "./identities";

const consentLocale = "en-US";
const administrationToolPrefix = "admin_";
const readToolName = "admin_list_sessions";
const destructiveToolName = "admin_revoke_session";
/** The read the destructive tool's preview shows instead of revoking. */
const destructivePreviewRead = "administration.listSessions";
const administrationConsentSection =
  'section[aria-labelledby="customer-agent-consent-administration"]';

/**
 * Where each case writes its evidence: tool names, counts, annotations, and
 * the top-level keys of the structured results. Nothing in it names an
 * account, a session, a token, or the preview.
 */
const evidencePath = (caseId: string) =>
  resolve(
    workspaceDir,
    "e2e-artifacts",
    "administrator-agent-tools",
    `${caseId}.json`
  );

test("lists the administration tools to an administrator's agent after the customer tools, previews a destructive call without confirm, and withdraws them with the grant", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}, testInfo) => {
  test.setTimeout(workspaceE2EAdministratorAgentToolsPlaywrightTimeout);
  const caseId = "administrator-agent-tools";
  const identities = makeWorkspaceE2EAdministrationIdentities<"aat-admin">({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  const config = getConfig(environment);
  let evidence: Record<string, unknown> | undefined;
  await runEffect(
    runAdministratorCase({
      baseURL,
      browser,
      bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      caseId,
      caseName: "administrator agent tools",
      timeoutMs: workspaceE2ETimeouts.administratorAgentToolsCase,
      body: Effect.fn(function* (step, { origin, session }) {
        const administrator = yield* step({
          execute: Effect.gen(function* () {
            const account = yield* identities.seed("aat-admin", [
              "administrator",
            ]);
            yield* identities.signIn(account, { origin, session });
            return account;
          }),
          id: "sign-in-seeded-administrator",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        const { accessToken, scopes } = yield* connectTestAgent({
          administrator: true,
          config,
          session,
          step,
        });
        evidence = yield* Effect.scoped(
          Effect.gen(function* () {
            const mcp = yield* step({
              execute: connectCustomerMcp({ accessToken, config }),
              id: "connect-agent-mcp",
              timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
            });
            const catalog = yield* step({
              execute: Effect.flatMap(listAgentTools(mcp, config), (tools) =>
                tryWorkspaceE2ESync(
                  "check the administration tool catalog",
                  () => checkAdministrationCatalog(tools)
                )
              ),
              id: "list-administration-tools",
              timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
            });
            const read = yield* step({
              execute: Effect.flatMap(
                callAgentTool(mcp, config, readToolName, {}),
                (result) =>
                  tryWorkspaceE2ESync(
                    `check the ${readToolName} result`,
                    () => {
                      const structured = expectToolSuccess(
                        readToolName,
                        result
                      );
                      assert(
                        Array.isArray(structured.items),
                        `${readToolName} did not answer { items }`
                      );
                      return { structuredKeys: keysOf(structured) };
                    }
                  )
              ),
              id: "call-administration-read",
              timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
            });
            const sessionId = crypto.randomUUID();
            const destructive = yield* step({
              execute: Effect.flatMap(
                callAgentTool(mcp, config, destructiveToolName, {
                  sessionId,
                }),
                (result) =>
                  tryWorkspaceE2ESync(
                    `check the ${destructiveToolName} preview`,
                    () =>
                      checkConfirmationRequired(
                        expectToolSuccess(destructiveToolName, result),
                        sessionId
                      )
                  )
              ),
              id: "preview-administration-destructive-call",
              timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
            });
            return {
              case: caseId,
              scopes,
              ...catalog,
              calls: {
                [readToolName]: { isError: false, ...read },
                [destructiveToolName]: {
                  arguments: ["sessionId"],
                  isError: false,
                  ...destructive,
                },
              },
            };
          })
        );
        // The token keeps its administration scope; the tools follow the
        // live grant.
        yield* step({
          execute: identities.revokeRoles(administrator),
          id: "revoke-administrator-grant",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        const afterRevocation = yield* expectNoAdministrationTools({
          accessToken,
          config,
          step,
        });
        evidence = { ...evidence, afterGrantRevocation: afterRevocation };
      }),
    })
  );
  await recordEvidence(testInfo, caseId, evidence);
});

test("lists no administration tools to a customer's agent that asks for the administration", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}, testInfo) => {
  test.setTimeout(workspaceE2EAdministratorAgentToolsPlaywrightTimeout);
  const caseId = "administrator-agent-tools-customer-refusal";
  const identities = makeWorkspaceE2EAdministrationIdentities<"aatc-member">({
    ownerId: caseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  const config = getConfig(environment);
  let evidence: Record<string, unknown> | undefined;
  await runEffect(
    runAdministratorCase({
      baseURL,
      browser,
      bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      caseId,
      caseName: "customer agent tools",
      timeoutMs: workspaceE2ETimeouts.administratorAgentToolsCase,
      body: Effect.fn(function* (step, { origin, session }) {
        yield* step({
          execute: Effect.gen(function* () {
            const member = yield* identities.seed("aatc-member", []);
            yield* identities.signIn(member, { origin, session });
          }),
          id: "sign-in-seeded-customer",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        const { accessToken, scopes } = yield* connectTestAgent({
          administrator: false,
          config,
          session,
          step,
        });
        const refusal = yield* expectNoAdministrationTools({
          accessToken,
          config,
          step,
        });
        evidence = { case: caseId, scopes, ...refusal };
      }),
    })
  );
  await recordEvidence(testInfo, caseId, evidence);
});

/**
 * Connects the test agent to the signed-in account: OAuth discovery from the
 * MCP challenge, one consent round in the browser for a customer scope and
 * the administration, and the code exchange. The consent page offers the
 * administration only to an administrator, so only an administrator's grant
 * carries it.
 */
const connectTestAgent = Effect.fn("connectTestAgent")(function* ({
  administrator,
  config,
  session,
  step,
}: {
  readonly administrator: boolean;
  readonly config: WorkspaceE2EConfig;
  readonly session: E2EBrowserSession;
  readonly step: WorkspaceE2EStepRunner;
}) {
  const server = yield* step({
    execute: discoverCustomerAgentAuthorization(config),
    id: "discover-agent-authorization",
    timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
  });
  const { callback, request } = yield* step({
    execute: allowAgentConsent({
      administrator,
      config,
      server,
      session,
    }),
    id: "allow-agent-consent",
    timeoutMs: workspaceE2ETimeouts.customerAgentConsent,
  });
  const expected = administrator
    ? administrationAgentRequestedScopes
    : administrationAgentRequestedScopes.filter(
        (scope) => scope !== administrationAgentScope
      );
  const withheld: readonly CustomerAgentRequestedScope[] = administrator
    ? []
    : [administrationAgentScope];
  const accessToken = yield* step({
    execute: Effect.flatMap(
      tryWorkspaceE2ESync("read agent authorization response", () => {
        assert(
          callback.kind === "code",
          "Allowing the agent did not answer an authorization code"
        );
        return callback;
      }),
      ({ code, iss }) =>
        exchangeCustomerAgentCode({
          clientId: customerAgentTestClientMetadata.client_id,
          code,
          config,
          expectedScopes: expected,
          iss,
          request,
          server,
          withheldScopes: withheld,
        })
    ),
    id: "exchange-agent-code",
    timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
  });
  // What the exchange verified, not the raw grant, which may carry more.
  return {
    accessToken,
    scopes: {
      verifiedGranted: [...expected].sort(),
      verifiedWithheld: withheld,
    },
  };
});

/**
 * The agent sends the signed-in account to the authorize endpoint for a
 * customer scope and the administration; the consent page shows the
 * administration section only to an administrator, and the account allows.
 */
const allowAgentConsent = Effect.fn("allowAgentConsent")(function* ({
  administrator,
  config,
  server,
  session,
}: {
  readonly administrator: boolean;
  readonly config: WorkspaceE2EConfig;
  readonly server: CustomerAgentAuthorizationServer;
  readonly session: E2EBrowserSession;
}) {
  const request = yield* startCustomerAgentAuthorization({
    clientId: customerAgentTestClientMetadata.client_id,
    config,
    scopes: administrationAgentRequestedScopes,
    server,
  });
  const callbackUrl = yield* session.use(
    "allow the agent on the consent page",
    async (page) => {
      await page.context().route(
        (url) => isCustomerAgentCallbackUrl(url.toString()),
        (route) =>
          route.fulfill({
            body: "<!doctype html><title>Agent callback</title>",
            contentType: "text/html",
            status: 200,
          })
      );
      await page.goto(request.authorizationUrl, {
        timeout: workspaceE2ETimeouts.browserNavigation,
      });
      await waitForBrowserLocation({
        baseUrl: config.baseUrl,
        expected: "the consent page",
        matches: (url) => isCustomerAgentConsentUrl(url, config.baseUrl),
        page,
      });
      const consentUrl = localizeCustomerAgentConsentUrl(
        page.url(),
        consentLocale
      );
      if (consentUrl !== page.url()) {
        await page.goto(consentUrl, {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
      }
      const allow = page.getByRole("button", {
        exact: true,
        name: m.customerAgentConsentAllow({}, { locale: consentLocale }),
      });
      await allow
        .waitFor({
          state: "visible",
          timeout: workspaceE2ETimeouts.uiTransition,
        })
        .catch(async () =>
          fail(
            `The consent page shows no Allow button; ${await describePageState(page)}`
          )
        );
      equal(
        await page.locator(administrationConsentSection).count(),
        administrator ? 1 : 0,
        administrator
          ? "The consent page does not ask the administrator about the administration"
          : "The consent page asks a customer about the administration"
      );
      await waitForReactClickHandler(page, allow);
      const consentAnswer = describeConsentAnswer(page, config.baseUrl);
      await allow.click({ timeout: workspaceE2ETimeouts.browserAction });
      await waitForBrowserLocation({
        baseUrl: config.baseUrl,
        detail: consentAnswer,
        expected: "the agent's redirect URI after Allow",
        matches: (url) => {
          if (!isCustomerAgentCallbackUrl(url)) return false;
          // Registered before any log line can carry the URL.
          addRedaction(new URL(url).searchParams.get("code") ?? "", true);
          return true;
        },
        page,
      });
      return page.url();
    }
  );
  const callback = yield* tryWorkspaceE2ESync(
    "read agent authorization response",
    () => readCustomerAgentCallback(callbackUrl, request.state)
  );
  return { callback, request };
});

/**
 * A fresh MCP client with the token lists no administration tools, and a
 * call to one is refused as unknown.
 */
const expectNoAdministrationTools = Effect.fn("expectNoAdministrationTools")(
  function* ({
    accessToken,
    config,
    step,
  }: {
    readonly accessToken: string;
    readonly config: WorkspaceE2EConfig;
    readonly step: WorkspaceE2EStepRunner;
  }) {
    const mcp = yield* step({
      execute: connectCustomerMcp({ accessToken, config }),
      id: "connect-agent-mcp-without-administration",
      timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
    });
    const tools = yield* step({
      execute: Effect.flatMap(listAgentTools(mcp, config), (listed) =>
        tryWorkspaceE2ESync("check the tool catalog", () => {
          assert(listed.length > 0, "The agent lists no tools");
          assert(
            !listed.some(isAdministrationTool),
            "The agent lists administration tools"
          );
          return { administration: 0, total: listed.length };
        })
      ),
      id: "list-tools-without-administration",
      timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
    });
    const refusal = yield* step({
      execute: expectUnknownTool(mcp, config, readToolName),
      id: "refuse-administration-call",
      timeoutMs: workspaceE2ETimeouts.customerMcpRequest,
    });
    return { calls: { [readToolName]: refusal }, tools };
  },
  Effect.scoped
);

/**
 * Waits for the browser to reach a URL by polling it, as `waitForBrowserUrl`
 * does: after Allow, Better Auth's client and the consent page both navigate
 * to the agent's redirect URI, and `page.waitForURL` can reject on the first,
 * aborted navigation. On a timeout it fails with where the browser is
 * instead, in code-owned terms only: no host, query, or page text.
 */
const waitForBrowserLocation = async ({
  baseUrl,
  detail,
  expected,
  matches,
  page,
}: {
  readonly baseUrl: string;
  /** More context for the failure message, such as the consent answer. */
  readonly detail?: Promise<string>;
  readonly expected: string;
  readonly matches: (url: string) => boolean;
  readonly page: Page;
}) => {
  try {
    await expect
      .poll(() => matches(page.url()), {
        timeout: workspaceE2ETimeouts.uiTransition,
      })
      .toBe(true);
  } catch {
    fail(
      `The browser did not reach ${expected}; it is on ${describeDestination(page.url(), baseUrl)}, ${await describePageState(page)}${detail ? `; ${await detail}` : ""}`
    );
  }
};

/** The OAuth error codes a failure message may name; others aren't echoed. */
const reportableOAuthErrors = new Set([
  "access_denied",
  "client_disabled",
  "consent_required",
  "interaction_required",
  "invalid_client",
  "invalid_grant",
  "invalid_redirect",
  "invalid_request",
  "invalid_scope",
  "invalid_target",
  "login_required",
  "server_error",
  "temporarily_unavailable",
  "unauthorized_client",
  "unsupported_response_type",
]);

const oauthErrorCode = (value: unknown) => {
  if (value === null || value === undefined) return "none";
  return typeof value === "string" && reportableOAuthErrors.has(value)
    ? value
    : "unrecognized";
};

/** The preview pages a failure message may name, by path suffix. */
const reportablePreviewPages = [
  ["/auth/consent", "the consent page"],
  ["/auth/connect", "the connect page"],
  ["/auth/sign-in", "the sign-in page"],
  ["/api/auth/error", "the auth error page"],
] as const;

/**
 * Where a URL points: the agent's redirect URI with its OAuth error code, a
 * known preview page, another preview path, or another origin.
 */
const describeDestination = (url: string, baseUrl: string) => {
  const target = parseUrl(url);
  if (target === undefined) return "an unreadable URL";
  if (isCustomerAgentCallbackUrl(target.toString())) {
    return `the agent's redirect URI with error ${oauthErrorCode(target.searchParams.get("error"))}`;
  }
  if (target.origin !== new URL(baseUrl).origin) return "another origin";
  return (
    reportablePreviewPages.find(([suffix]) =>
      target.pathname.endsWith(suffix)
    )?.[1] ?? "another preview path"
  );
};

/** Whether the page shows the consent buttons and an alert. */
const describePageState = async (page: Page) => {
  const count = (locator: ReturnType<Page["locator"]>) =>
    locator.count().catch(() => -1);
  const [allow, alerts] = await Promise.all([
    count(
      page.getByRole("button", {
        exact: true,
        name: m.customerAgentConsentAllow({}, { locale: consentLocale }),
      })
    ),
    count(page.getByRole("alert").filter({ hasText: /\S/ })),
  ]);
  return `Allow buttons ${allow}, non-empty alerts ${alerts}`;
};

/**
 * What the OAuth server answered the page's consent request: the status and
 * where it sends the browser, in the same code-owned terms.
 */
const describeConsentAnswer = (page: Page, baseUrl: string) =>
  page
    .waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/oauth2/consent"),
      { timeout: workspaceE2ETimeouts.uiTransition }
    )
    .then(
      async (response) => {
        const body: unknown = await response.json().catch(() => undefined);
        const destination =
          isRecord(body) && typeof body.url === "string"
            ? describeDestination(body.url, baseUrl)
            : "nowhere";
        const error = oauthErrorCode(isRecord(body) ? body.error : undefined);
        return `the consent answer was ${response.status()} with error ${error}, sending the browser to ${destination}`;
      },
      () => "the page sent no consent answer"
    );

const listAgentTools = (mcp: Client, config: WorkspaceE2EConfig) =>
  tryWorkspaceE2EPromise("list agent tools", async () => {
    const { tools } = await mcp.listTools(undefined, {
      timeout: config.timeouts.customerMcpRequest,
    });
    return tools;
  });

const isAdministrationTool = ({ name }: Pick<Tool, "name">) =>
  name.startsWith(administrationToolPrefix);

const annotationsOf = (tool: Tool | undefined) => ({
  destructiveHint: tool?.annotations?.destructiveHint,
  idempotentHint: tool?.annotations?.idempotentHint,
  readOnlyHint: tool?.annotations?.readOnlyHint,
});

/**
 * The administrator's catalog lists the customer tools first, then the
 * administration tools; the session read is read-only and the revocation is
 * destructive.
 */
const checkAdministrationCatalog = (tools: readonly Tool[]) => {
  const firstAdministration = tools.findIndex(isAdministrationTool);
  const customer = tools.filter((tool) => !isAdministrationTool(tool));
  const administration = tools.filter(isAdministrationTool);
  assert(
    customer.length > 0,
    "The administrator's agent lists no customer tools"
  );
  assert(
    firstAdministration === customer.length,
    "The administration tools are not listed after the customer tools"
  );
  const read = tools.find(({ name }) => name === readToolName);
  const destructive = tools.find(({ name }) => name === destructiveToolName);
  assert(read, `The administrator's agent does not list ${readToolName}`);
  assert(
    destructive,
    `The administrator's agent does not list ${destructiveToolName}`
  );
  assert(
    read.annotations?.readOnlyHint === true,
    `${readToolName} is not annotated read-only`
  );
  assert(
    destructive.annotations?.destructiveHint === true,
    `${destructiveToolName} is not annotated destructive`
  );
  return {
    tools: {
      administration: administration.length,
      customer: customer.length,
      total: tools.length,
    },
    administrationToolNames: administration.map(({ name }) => name),
    annotations: {
      [readToolName]: annotationsOf(read),
      [destructiveToolName]: annotationsOf(destructive),
    },
  };
};

/** Calls a tool and returns its raw result, tool errors included. */
const callAgentTool = (
  mcp: Client,
  config: WorkspaceE2EConfig,
  name: string,
  toolArguments: Record<string, unknown>
) =>
  tryWorkspaceE2EPromise(`call MCP ${name}`, () =>
    mcp.callTool(
      { arguments: toolArguments, name },
      { timeout: config.timeouts.customerMcpRequest }
    )
  );

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keysOf = (value: Record<string, unknown>) => Object.keys(value).sort();

/** A successful tool result's structured content. */
const expectToolSuccess = (name: string, result: ToolCallResult) => {
  assert(result.isError !== true, `MCP ${name} answered a tool error`);
  const structured = result.structuredContent;
  assert(isRecord(structured), `MCP ${name} answered no structured content`);
  return structured;
};

/**
 * A destructive call without `confirm: true` answers what it would act on
 * and the arguments to repeat, and runs nothing.
 */
const checkConfirmationRequired = (
  structured: Record<string, unknown>,
  sessionId: string
) => {
  assert(
    structured.outcome === "confirmation-required",
    `${destructiveToolName} without confirm did not ask for confirmation`
  );
  assert(
    structured.operation === destructiveToolName,
    `${destructiveToolName} names another operation to confirm`
  );
  const { current, input } = structured;
  assert(
    isRecord(input) && input.sessionId === sessionId && !("confirm" in input),
    `${destructiveToolName} does not answer its arguments to repeat`
  );
  assert(
    isRecord(current) && isRecord(current[destructivePreviewRead]),
    `${destructiveToolName} does not preview the sessions it would act on`
  );
  return {
    currentKeys: keysOf(current),
    inputKeys: keysOf(input),
    operation: structured.operation,
    outcome: structured.outcome,
    structuredKeys: keysOf(structured),
  };
};

/**
 * The customer's MCP server has no such tool, so the call is refused as
 * invalid parameters before anything runs.
 */
const expectUnknownTool = (
  mcp: Client,
  config: WorkspaceE2EConfig,
  name: string
) =>
  tryWorkspaceE2EPromise(`call unlisted MCP ${name}`, async () => {
    const refusal = await mcp
      .callTool(
        { arguments: {}, name },
        {
          timeout: config.timeouts.customerMcpRequest,
        }
      )
      .then(
        (result) => ({ isError: result.isError === true }) as const,
        (error: unknown) => {
          if (
            error instanceof ProtocolError &&
            error.code === ProtocolErrorCode.InvalidParams
          ) {
            return { protocolErrorCode: error.code } as const;
          }
          throw error;
        }
      );
    assert(
      !("isError" in refusal) || refusal.isError,
      `MCP ${name} ran for a customer's agent`
    );
    return refusal;
  });

/** Writes the case's evidence file and attaches it to the test result. */
const recordEvidence = async (
  testInfo: TestInfo,
  caseId: string,
  evidence: Record<string, unknown> | undefined
) => {
  if (evidence === undefined) return;
  const path = evidencePath(caseId);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`);
  await testInfo.attach(caseId, { contentType: "application/json", path });
};

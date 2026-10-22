import { equal } from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type Client,
  ProtocolError,
  ProtocolErrorCode,
  type Tool,
} from "@modelcontextprotocol/client";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { Effect } from "effect";
import { administrationAgentScope } from "@/features/account/agent-scopes";
import { customerAgentTestClientMetadata } from "@/features/account/customer-agent-test-client";
import { m } from "@/features/i18n";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import {
  openAdminBrowserPage,
  sanitizedBrowserOperation,
} from "../admin-case";
import { getConfig, type WorkspaceE2EConfig } from "../config";
import {
  administrationAgentRequestedScopes,
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
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { waitForReactClickHandler } from "../react-handlers";
import { addRedaction, assert, workspaceDir } from "../runtime";
import {
  workspaceE2EAdministratorAgentToolsPlaywrightTimeout,
  workspaceE2ETimeouts,
} from "../timeouts";
import {
  type AdministratorCaseStep,
  runAdministratorCase,
} from "./administrator-case";
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

test("lists the administration tools to an administrator's agent after the customer tools, and previews a destructive call without changing anything", async ({
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
  const { context, origin, page } = await openAdminBrowserPage({
    baseURL,
    browser,
    caseName: "administrator agent tools",
  });
  let evidence: Record<string, unknown> | undefined;
  try {
    await runEffect(
      runAdministratorCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        timeoutMs: workspaceE2ETimeouts.administratorAgentToolsCase,
        body: (step) =>
          Effect.gen(function* () {
            yield* step(
              "sign-in-seeded-administrator",
              workspaceE2ETimeouts.datasource,
              Effect.gen(function* () {
                const administrator = yield* identities.seed("aat-admin", [
                  "administrator",
                ]);
                yield* identities.signIn(administrator, { context, origin });
              })
            );
            const { accessToken, grantedScopes } = yield* connectTestAgent({
              administrator: true,
              config,
              context,
              page,
              step,
            });
            evidence = yield* Effect.scoped(
              Effect.gen(function* () {
                const mcp = yield* step(
                  "connect-agent-mcp",
                  workspaceE2ETimeouts.customerMcpRequest,
                  connectCustomerMcp({ accessToken, config })
                );
                const catalog = yield* step(
                  "list-administration-tools",
                  workspaceE2ETimeouts.customerMcpRequest,
                  Effect.flatMap(listAgentTools(mcp, config), (tools) =>
                    tryWorkspaceE2ESync(
                      "check the administration tool catalog",
                      () => checkAdministrationCatalog(tools)
                    )
                  )
                );
                const read = yield* step(
                  "call-administration-read",
                  workspaceE2ETimeouts.customerMcpRequest,
                  Effect.flatMap(
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
                  )
                );
                const sessionId = crypto.randomUUID();
                const destructive = yield* step(
                  "preview-administration-destructive-call",
                  workspaceE2ETimeouts.customerMcpRequest,
                  Effect.flatMap(
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
                  )
                );
                return {
                  case: caseId,
                  grantedScopes,
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
          }),
      })
    );
  } finally {
    await context.close().catch(() => undefined);
  }
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
  const { context, origin, page } = await openAdminBrowserPage({
    baseURL,
    browser,
    caseName: "customer agent tools",
  });
  let evidence: Record<string, unknown> | undefined;
  try {
    await runEffect(
      runAdministratorCase({
        bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        caseId,
        context,
        origin,
        reportFailure:
          runContext.githubRunId === undefined
            ? undefined
            : writeWorkspaceE2EFailureAnnotation,
        timeoutMs: workspaceE2ETimeouts.administratorAgentToolsCase,
        body: (step) =>
          Effect.gen(function* () {
            yield* step(
              "sign-in-seeded-customer",
              workspaceE2ETimeouts.datasource,
              Effect.gen(function* () {
                const member = yield* identities.seed("aatc-member", []);
                yield* identities.signIn(member, { context, origin });
              })
            );
            const { accessToken, grantedScopes } = yield* connectTestAgent({
              administrator: false,
              config,
              context,
              page,
              step,
            });
            evidence = yield* Effect.scoped(
              Effect.gen(function* () {
                const mcp = yield* step(
                  "connect-agent-mcp",
                  workspaceE2ETimeouts.customerMcpRequest,
                  connectCustomerMcp({ accessToken, config })
                );
                const tools = yield* step(
                  "list-customer-tools",
                  workspaceE2ETimeouts.customerMcpRequest,
                  Effect.flatMap(listAgentTools(mcp, config), (listed) =>
                    tryWorkspaceE2ESync(
                      "check the customer tool catalog",
                      () => {
                        assert(
                          listed.length > 0,
                          "The customer's agent lists no tools"
                        );
                        assert(
                          !listed.some(isAdministrationTool),
                          "The customer's agent lists administration tools"
                        );
                        return { total: listed.length, administration: 0 };
                      }
                    )
                  )
                );
                const refusal = yield* step(
                  "refuse-administration-call",
                  workspaceE2ETimeouts.customerMcpRequest,
                  expectUnknownTool(mcp, config, readToolName)
                );
                return {
                  case: caseId,
                  grantedScopes,
                  tools,
                  calls: { [readToolName]: refusal },
                };
              })
            );
          }),
      })
    );
  } finally {
    await context.close().catch(() => undefined);
  }
  await recordEvidence(testInfo, caseId, evidence);
});

/**
 * Connects the test agent to the signed-in account: OAuth discovery from the
 * MCP challenge, one consent round in the browser for a customer scope and
 * the administration, and the code exchange. The consent page offers the
 * administration only to an administrator, so only an administrator's grant
 * carries it.
 */
const connectTestAgent = ({
  administrator,
  config,
  context,
  page,
  step,
}: {
  readonly administrator: boolean;
  readonly config: WorkspaceE2EConfig;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly step: AdministratorCaseStep;
}) =>
  Effect.gen(function* () {
    const server = yield* step(
      "discover-agent-authorization",
      workspaceE2ETimeouts.customerMcpRequest,
      discoverCustomerAgentAuthorization(config)
    );
    const { callback, request } = yield* step(
      "allow-agent-consent",
      workspaceE2ETimeouts.customerAgentConsent,
      allowAgentConsent({ administrator, config, context, page, server })
    );
    const expected = administrator
      ? administrationAgentRequestedScopes
      : administrationAgentRequestedScopes.filter(
          (scope) => scope !== administrationAgentScope
        );
    const accessToken = yield* step(
      "exchange-agent-code",
      workspaceE2ETimeouts.customerMcpRequest,
      Effect.flatMap(
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
            withheldScopes: administrator ? [] : [administrationAgentScope],
          })
      )
    );
    return { accessToken, grantedScopes: [...expected].sort() };
  });

/**
 * The agent sends the signed-in account to the authorize endpoint for a
 * customer scope and the administration; the consent page shows the
 * administration section only to an administrator, and the account allows.
 */
const allowAgentConsent = ({
  administrator,
  config,
  context,
  page,
  server,
}: {
  readonly administrator: boolean;
  readonly config: WorkspaceE2EConfig;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly server: CustomerAgentAuthorizationServer;
}) =>
  Effect.gen(function* () {
    const request = yield* startCustomerAgentAuthorization({
      clientId: customerAgentTestClientMetadata.client_id,
      config,
      scopes: administrationAgentRequestedScopes,
      server,
    });
    const callbackUrl = yield* sanitizedBrowserOperation(
      "allow the agent on the consent page",
      async () => {
        await context.route(
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
        await page.waitForURL(
          (url) => isCustomerAgentConsentUrl(url.toString(), config.baseUrl),
          { timeout: workspaceE2ETimeouts.uiTransition }
        );
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
        await allow.waitFor({
          state: "visible",
          timeout: workspaceE2ETimeouts.uiTransition,
        });
        equal(
          await page.locator(administrationConsentSection).count(),
          administrator ? 1 : 0,
          administrator
            ? "The consent page does not ask the administrator about the administration"
            : "The consent page asks a customer about the administration"
        );
        await waitForReactClickHandler(page, allow);
        await allow.click({ timeout: workspaceE2ETimeouts.browserAction });
        await page.waitForURL(
          (url) => {
            if (!isCustomerAgentCallbackUrl(url.toString())) return false;
            // Registered before any log line can carry the URL.
            addRedaction(url.searchParams.get("code") ?? "", true);
            return true;
          },
          { timeout: workspaceE2ETimeouts.uiTransition }
        );
        return page.url();
      }
    );
    const callback = yield* tryWorkspaceE2ESync(
      "read agent authorization response",
      () => readCustomerAgentCallback(callbackUrl, request.state)
    );
    return { callback, request };
  });

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
  assert(customer.length > 0, "The administrator's agent lists no customer tools");
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
      .callTool({ arguments: {}, name }, {
        timeout: config.timeouts.customerMcpRequest,
      })
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

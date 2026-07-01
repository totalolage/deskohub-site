import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DotyposRuntimeConfig, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";

const WORKSPACE_PROJECT_ID = "prj_7FliQBcbBiBwGaO2JLrigicnXCRd";
const WORKSPACE_TEAM_ID = "team_MgMQ4MEWijWnYa1R48C2JU5e";
const DEFAULT_ALIAS = "new.workspace.deskohub.cz";
const NEXI_TEST_CARD_NUMBER = "4509034543615006";
const NEXI_TEST_CVV = "298";
const NEXI_TEST_EXPIRY = "1028";
const POLL_INTERVAL_MS = 5_000;

type CheckoutRow = {
  reservation_id: string;
  correlation_id: string;
  dotypos_customer_id: string | null;
  dotypos_reservation_id: string | null;
  reservation_state: string;
  payment_state: string;
  fulfillment_state: string;
  active_payment_attempt_id: string | null;
  product_tier: string;
  product_coffee: boolean;
  product_monitor_option: string | null;
  locale: string;
  reservation_created_at: Date | null;
  reservation_confirmed_at: Date | null;
  reservation_cancelled_at: Date | null;
  reservation_hold_expired_at: Date | null;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  fulfillment_failed_at: Date | null;
  failure_code: string | null;
  fulfillment_failure_code: string | null;
  payment_attempt_id: string | null;
  provider: string | null;
  provider_order_id: string | null;
  security_token: string | null;
  payment_attempt_state: string | null;
  amount_value: number | null;
  amount_exponent: number | null;
  currency: string | null;
  provider_redirect_url: string | null;
  last_webhook_event_id: string | null;
  last_provider_operation_id: string | null;
  last_provider_status: string | null;
  payment_failure_code: string | null;
  webhook_id: string | null;
  webhook_provider: string | null;
  webhook_event_id: string | null;
  webhook_provider_order_id: string | null;
  webhook_processed_at: Date | null;
  webhook_state: string | null;
  webhook_error_code: string | null;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceDir = resolve(scriptDir, "..");
const repoRoot = resolve(workspaceDir, "../..");
const redactions = new Set<string>();

const main = async () => {
  await loadEnvFile(resolve(workspaceDir, ".env.local"));

  const config = getConfig();
  const run = makeRunner(config);
  const session = `workspace-checkout-e2e-${Date.now()}`;
  const artifactDir = resolve(workspaceDir, "e2e-artifacts", session);
  let datasourceConfig: ReturnType<typeof getDatasourceConfig> | undefined;
  let checkoutRow: CheckoutRow | undefined;
  let checkoutOrderId: string | undefined;
  let checkoutStartedAt: Date | undefined;
  let browserHarStarted = false;
  let browserHarStopped = false;
  let cleanupError: unknown;
  let workflowError: unknown;

  try {
    await writeVercelProjectLink(config);
    await run("git", ["status", "--short"], { cwd: repoRoot });
    await run("bunx", [
      "vercel@latest",
      "pull",
      "--yes",
      "--environment=preview",
      "--cwd",
      repoRoot,
      "--token",
      config.vercelToken,
    ]);
    await loadEnvFile(resolve(repoRoot, ".vercel/.env.preview.local"));
    datasourceConfig = getDatasourceConfig();
    assertSafeDatabaseUrl(datasourceConfig.databaseUrl, "DATABASE_URL");
    assertSafeDatabaseUrl(
      datasourceConfig.databaseUrlUnpooled,
      "DATABASE_URL_UNPOOLED"
    );
    assertNexiSandbox(datasourceConfig.nexiApiOrigin);

    const deploy = await run(
      "bunx",
      [
        "vercel@latest",
        "deploy",
        "--yes",
        "--force",
        "--archive=tgz",
        "--cwd",
        repoRoot,
        ...getVercelDeployEnvArgs(config, datasourceConfig),
        "--token",
        config.vercelToken,
      ],
      { timeoutMs: 20 * 60 * 1000 }
    );
    const previewUrl = extractDeploymentUrl(deploy.stdout);
    const deployment = await getDeployment(config, previewUrl);

    if (await recordAliasPreflight(config, deployment.id))
      await assignAlias(config, deployment.id);
    await verifyAlias(config, deployment.id);
    await assertWebhookEndpoint(config, "/api/webhooks/nexi");
    await assertWebhookEndpoint(config, "/api/webhooks/resend");

    const data = makeCheckoutData(
      config.aliasUrl,
      await selectAvailableCheckoutDate(config)
    );
    for (const value of [
      data.checkoutUrl,
      data.email,
      data.message,
      data.name,
      data.phone,
    ])
      addRedaction(value);

    browserHarStarted = await startBrowserDiagnostics(run, session);
    checkoutStartedAt = new Date();
    const orderId = await completeCheckout({
      config,
      data,
      onOrderId: (orderId) => {
        checkoutOrderId = orderId;
      },
      run,
      session,
    });
    checkoutOrderId = orderId;
    // Nexi verification happens inside the deployed webhook handler. The runner
    // validates the resulting payment/webhook state without holding Nexi secrets.
    const replayRow = await waitForWebhookReplayRow(
      datasourceConfig,
      orderId,
      (row) => {
        checkoutRow = row;
      }
    );
    await replayNexiWebhook(config, replayRow);
    checkoutRow = await validatePostgres(
      datasourceConfig,
      data,
      orderId,
      (row) => {
        checkoutRow = row;
      }
    );
    await verifyAlias(config, deployment.id);
    await assertFulfilledStatusPage({ config, orderId, run, session });
    await validateDotypos(datasourceConfig, data, checkoutRow);

    log(`Checkout e2e passed for order ${orderId}`);
  } catch (cause) {
    workflowError = cause;
  } finally {
    if (
      datasourceConfig &&
      !checkoutRow?.dotypos_reservation_id &&
      checkoutOrderId
    ) {
      try {
        checkoutRow = await readCleanupCheckoutRow(
          datasourceConfig,
          checkoutOrderId
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(`Dotypos cleanup row lookup failed: ${redact(String(cause))}`);
      }
    }
    if (
      datasourceConfig &&
      !checkoutRow?.dotypos_reservation_id &&
      checkoutStartedAt
    ) {
      try {
        checkoutRow = await readLatestCleanupCheckoutRow(
          datasourceConfig,
          checkoutStartedAt
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(
            `Dotypos fallback cleanup row lookup failed: ${redact(String(cause))}`
          );
      }
    }
    if (datasourceConfig && checkoutRow?.dotypos_reservation_id) {
      try {
        await cancelDotyposReservation(
          datasourceConfig,
          checkoutRow.dotypos_reservation_id
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(`Dotypos cleanup failed: ${redact(String(cause))}`);
      }
    }
  }

  if (workflowError)
    browserHarStopped = await captureBrowserFailureArtifacts({
      artifactDir,
      cause: workflowError,
      harStarted: browserHarStarted,
      run,
      session,
    });

  if (browserHarStarted && !browserHarStopped)
    await stopBrowserHar(run, session, devNull);
  await run("agent-browser", ["--session", session, "close"], {
    allowFailure: true,
  });

  if (workflowError) throw workflowError;
  if (cleanupError) throw cleanupError;
};

const getConfig = () => {
  const vercelToken = requireEnv("VERCEL_TOKEN");
  const vercelTeamId =
    env("VERCEL_TEAM_ID") ?? env("VERCEL_ORG_ID") ?? WORKSPACE_TEAM_ID;
  const vercelProjectId = env("VERCEL_PROJECT_ID") ?? WORKSPACE_PROJECT_ID;
  const alias = env("WORKSPACE_E2E_ALIAS") ?? DEFAULT_ALIAS;
  const bypassSecret = env("VERCEL_AUTOMATION_BYPASS_SECRET");

  addRedaction(vercelToken);
  addRedaction(bypassSecret);

  return {
    alias,
    aliasUrl: `https://${alias}`,
    bypassSecret,
    vercelProjectId,
    vercelTeamId,
    vercelToken,
  };
};

const getDatasourceConfig = () => {
  const databaseUrl = requireEnv("DATABASE_URL");
  const databaseUrlUnpooled =
    env("WORKSPACE_E2E_DATABASE_URL_UNPOOLED") ?? databaseUrl;
  addRedaction(databaseUrlUnpooled);

  return {
    databaseUrl,
    databaseUrlUnpooled,
    dotypos: {
      apiTimeout: Number(env("DOTYPOS_API_TIMEOUT") ?? 5_000),
      apiUrl: requireEnv("DOTYPOS_API_URL"),
      branchId: requireEnv("DOTYPOS_BRANCH_ID"),
      clientId: requireEnv("DOTYPOS_CLIENT_ID"),
      clientSecret: requireEnv("DOTYPOS_CLIENT_SECRET"),
      cloudId: requireEnv("DOTYPOS_CLOUD_ID"),
      employeeId: requireEnv("DOTYPOS_EMPLOYEE_ID"),
      refreshToken: requireEnv("DOTYPOS_REFRESH_TOKEN"),
    },
    expectedCurrency: env("WORKSPACE_E2E_EXPECTED_CURRENCY") ?? "EUR",
    nexiApiOrigin: requireEnv("NEXI_API_ORIGIN"),
  };
};

const getCheckoutTimeoutMs = () =>
  readCappedTimeoutMs("WORKSPACE_E2E_CHECKOUT_TIMEOUT_MS", 10 * 60 * 1000);

const getDatasourceTimeoutMs = () =>
  readCappedTimeoutMs("WORKSPACE_E2E_DATASOURCE_TIMEOUT_MS", 4 * 60 * 1000);

const readCappedTimeoutMs = (name: string, fallbackMs: number) => {
  const raw = env(name);
  const value = raw ? Number(raw) : fallbackMs;
  if (!Number.isFinite(value) || value <= 0) return fallbackMs;
  return Math.min(value, fallbackMs);
};

const assertNexiSandbox = (origin: string) =>
  assert(
    parseUrl(origin)?.hostname === "xpaysandbox.nexigroup.com",
    "NEXI_API_ORIGIN must point at Nexi sandbox for workspace checkout e2e"
  );

const getVercelDeployEnvArgs = (
  config: ReturnType<typeof getConfig>,
  datasourceConfig: ReturnType<typeof getDatasourceConfig>
) => {
  const values = {
    DATABASE_URL: datasourceConfig.databaseUrl,
    DATABASE_URL_UNPOOLED: datasourceConfig.databaseUrlUnpooled,
    DOTYPOS_API_TIMEOUT: String(datasourceConfig.dotypos.apiTimeout),
    DOTYPOS_API_URL: datasourceConfig.dotypos.apiUrl,
    DOTYPOS_BRANCH_ID: datasourceConfig.dotypos.branchId,
    DOTYPOS_CLIENT_ID: datasourceConfig.dotypos.clientId,
    DOTYPOS_CLIENT_SECRET: datasourceConfig.dotypos.clientSecret,
    DOTYPOS_CLOUD_ID: datasourceConfig.dotypos.cloudId,
    DOTYPOS_EMPLOYEE_ID: datasourceConfig.dotypos.employeeId,
    DOTYPOS_REFRESH_TOKEN: datasourceConfig.dotypos.refreshToken,
    NEXI_API_ORIGIN: datasourceConfig.nexiApiOrigin,
    NEXI_CHECKOUT_CURRENCY_OVERRIDE: datasourceConfig.expectedCurrency,
    WORKSPACE_CALLBACK_ORIGIN: config.aliasUrl,
    ...(config.bypassSecret
      ? { VERCEL_AUTOMATION_BYPASS_SECRET: config.bypassSecret }
      : {}),
  };

  const buildValues = Object.fromEntries(
    Object.entries(values).filter(
      ([key]) => key !== "VERCEL_AUTOMATION_BYPASS_SECRET"
    )
  );

  return [
    ...Object.entries(buildValues).flatMap(([key, value]) => [
      "--build-env",
      `${key}=${value}`,
    ]),
    ...Object.entries(values).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
  ];
};

const makeRunner =
  (config: ReturnType<typeof getConfig>) =>
  async (
    command: string,
    args: string[],
    options: {
      allowFailure?: boolean;
      cwd?: string;
      env?: Record<string, string | undefined>;
      input?: string;
      logCommand?: boolean;
      logOutput?: boolean;
      timeoutMs?: number;
    } = {}
  ) => {
    const printable = redact([command, ...args].join(" "));
    if (options.logCommand !== false) log(`$ ${printable}`);

    const child = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: {
        ...baseChildEnv(),
        VERCEL_ORG_ID: config.vercelTeamId,
        VERCEL_PROJECT_ID: config.vercelProjectId,
        ...options.env,
      },
      stderr: "pipe",
      stdin: options.input ? "pipe" : "ignore",
      stdout: "pipe",
    });

    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }

    const timeout = setTimeout(
      () => child.kill(),
      options.timeoutMs ?? 120_000
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]).finally(() => clearTimeout(timeout));

    const result = {
      exitCode,
      stderr: redact(stderr.trim()),
      stdout: redact(stdout.trim()),
    };

    if (exitCode !== 0 && !options.allowFailure) {
      throw new Error(
        `${options.logCommand === false ? command : printable} failed with ${exitCode}\n${result.stdout}\n${result.stderr}`.trim()
      );
    }

    if (options.logOutput !== false) {
      if (result.stdout) log(result.stdout);
      if (result.stderr) log(result.stderr);
    }

    return result;
  };

const baseChildEnv = () =>
  Object.fromEntries(
    ["CI", "HOME", "LANG", "PATH", "TMPDIR", "USER"].flatMap((key) => {
      const value = process.env[key];
      return value ? [[key, value]] : [];
    })
  );

const completeCheckout = async ({
  config,
  data,
  onOrderId,
  run,
  session,
}: {
  config: ReturnType<typeof getConfig>;
  data: ReturnType<typeof makeCheckoutData>;
  onOrderId?: (orderId: string) => void;
  run: ReturnType<typeof makeRunner>;
  session: string;
}) => {
  const headers = config.bypassSecret
    ? [
        "--headers",
        JSON.stringify({
          "x-vercel-protection-bypass": config.bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }),
      ]
    : [];

  await run(
    "agent-browser",
    ["--session", session, ...headers, "open", data.checkoutUrl],
    {
      timeoutMs: getCheckoutTimeoutMs(),
    }
  );
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: submitReservationScript,
    logOutput: false,
  });
  let payPageUrl: string;
  try {
    payPageUrl = await waitForBrowserUrl({
      description: "checkout pay page",
      matches: (url) => url.includes("/checkout/pay"),
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
  } catch (cause) {
    const currentUrl = await readBrowserUrl(run, session);
    const orderId = getSearchOrderId(currentUrl);
    if (orderId) onOrderId?.(orderId);
    throw cause;
  }
  const payPageOrderId =
    getSearchOrderId(payPageUrl) ?? (await readPayPageOrderId(run, session));
  onOrderId?.(payPageOrderId);
  await submitPaymentAndWaitForHostedPage({ run, session });
  await completeNexiHostedPayment({ data, run, session });
  await waitForBrowserUrl({
    description: "checkout status page",
    matches: (url) => {
      const parsed = parseUrl(url);
      return (
        parsed?.host === config.alias &&
        parsed.pathname.includes("/checkout/status/")
      );
    },
    run,
    session,
    timeoutMs: getCheckoutTimeoutMs(),
  });

  const url = await run("agent-browser", ["--session", session, "get", "url"]);
  const orderId = extractOrderId(url.stdout);
  log(`Reached checkout status for order ${orderId}`);
  return orderId;
};

const readPayPageOrderId = async (
  run: ReturnType<typeof makeRunner>,
  session: string
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "eval", "--stdin"],
    {
      input: payPageOrderIdScript,
      logOutput: false,
      timeoutMs: 30_000,
    }
  );
  const orderId = result.stdout.trim();
  assert(orderId, "checkout pay page order id missing");
  return orderId;
};

const readBrowserUrl = async (
  run: ReturnType<typeof makeRunner>,
  session: string
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "get", "url"],
    { allowFailure: true, logOutput: false }
  );
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
};

const isCheckoutStatusUrl = (url: string | undefined) =>
  parseUrl(url ?? "")?.pathname.includes("/checkout/status/") ?? false;

const submitPaymentAndWaitForHostedPage = async ({
  run,
  session,
}: {
  run: ReturnType<typeof makeRunner>;
  session: string;
}) => {
  const timeoutMs = Math.min(getCheckoutTimeoutMs(), 2 * 60 * 1000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await run("agent-browser", ["--session", session, "eval", "--stdin"], {
      input: submitPaymentScript,
      logOutput: false,
    });

    try {
      return await waitForBrowserUrl({
        description: "Nexi hosted payment page",
        matches: (url) =>
          url.includes("nexigroup.com") || url.includes("/hpp/nexi/"),
        run,
        session,
        timeoutMs,
      });
    } catch (error) {
      const diagnostics = String(
        error instanceof Error ? error.message : error
      );
      if (attempt === 3 || !isRetryablePaymentStartFailure(diagnostics))
        throw error;

      log(`Retrying payment start after client-side failure (${attempt}/3)`);
    }
  }
};

const isRetryablePaymentStartFailure = (diagnostics: string) =>
  diagnostics.includes("/checkout/pay") &&
  /Payment could not be started/i.test(diagnostics);

const completeNexiHostedPayment = async ({
  data,
  run,
  session,
}: {
  data: ReturnType<typeof makeCheckoutData>;
  run: ReturnType<typeof makeRunner>;
  session: string;
}) => {
  addRedaction(NEXI_TEST_CARD_NUMBER);
  addRedaction(NEXI_TEST_CVV, true);
  addRedaction(NEXI_TEST_EXPIRY, true);

  await fillHostedPaymentField(
    run,
    session,
    ["Card number", "Numero carta", "Numero della carta"],
    ["CARD_NUMBER"],
    NEXI_TEST_CARD_NUMBER
  );
  await fillHostedPaymentField(
    run,
    session,
    ["Expiration date", "Scadenza", "Data scadenza"],
    ["EXPIRATION_DATE"],
    NEXI_TEST_EXPIRY
  );
  await fillHostedPaymentField(
    run,
    session,
    ["CVV", "CVC", "Codice sicurezza"],
    ["SECURITY_CODE"],
    NEXI_TEST_CVV
  );
  await tryFillHostedPaymentField(
    run,
    session,
    ["First Name", "Nome", "Titolare"],
    ["CARDHOLDER_NAME"],
    data.name
  );
  await tryFillHostedPaymentField(
    run,
    session,
    ["Email", "E-mail"],
    ["CARDHOLDER_EMAIL"],
    data.email
  );

  await clickHostedPaymentTarget(
    run,
    session,
    "continue",
    [{ value: "CONTINUE" }, { value: "Continue" }, { value: "CONTINUA" }],
    { optional: true, timeoutMs: Math.min(getCheckoutTimeoutMs(), 15_000) }
  );
  await clickHostedPaymentTarget(run, session, "pay", [
    { value: "PAY" },
    { value: "Pay" },
    { value: "PAGA" },
  ]);
  await clickHostedPaymentTarget(run, session, "3DS success", [
    { value: "AUTENTICAZIONE RIUSCITA" },
    { value: "Authentication successful" },
  ]);
  if (isCheckoutStatusUrl(await readBrowserUrl(run, session))) {
    log(
      "Nexi back-to-shop action skipped; checkout status page already loaded"
    );
    return;
  }
  try {
    await clickHostedPaymentTarget(run, session, "back to shop", [
      { value: "BACK TO THE SHOP" },
      { value: "Back to the shop" },
      { value: "TORNA AL NEGOZIO" },
    ]);
  } catch (cause) {
    if (isCheckoutStatusUrl(await readBrowserUrl(run, session))) {
      log(
        "Nexi back-to-shop action skipped; checkout status page already loaded"
      );
      return;
    }
    throw cause;
  }
};

const fillHostedPaymentField = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  value: string
) => {
  const target = await requireHostedPaymentRef(
    run,
    session,
    labels,
    frameLabels
  );
  try {
    await run(
      "agent-browser",
      ["--session", session, "fill", target.ref, value],
      {
        logCommand: false,
        timeoutMs: 60_000,
      }
    );
  } finally {
    if (target.framed) await switchToMainFrame(run, session);
  }
};

const requireHostedPaymentRef = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[]
) => {
  try {
    return await poll(
      async () => findHostedPaymentRef(run, session, labels, frameLabels),
      60_000,
      `Nexi target ${labels.join(" / ")}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const snapshot = await readInteractiveSnapshot(run, session);
    throw new Error(`${message}\n${summarizeHostedPaymentSnapshot(snapshot)}`);
  }
};

const tryFillHostedPaymentField = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[],
  value: string
) => {
  const target = await findHostedPaymentRef(run, session, labels, frameLabels);
  if (!target) return;
  try {
    await run(
      "agent-browser",
      ["--session", session, "fill", target.ref, value],
      {
        allowFailure: true,
        logCommand: false,
        timeoutMs: 30_000,
      }
    );
  } finally {
    if (target.framed) await switchToMainFrame(run, session);
  }
};

type HostedPaymentRef = {
  readonly framed: boolean;
  readonly ref: string;
};

const findHostedPaymentRef = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  labels: readonly string[],
  frameLabels: readonly string[]
): Promise<HostedPaymentRef | undefined> => {
  const snapshot = await readInteractiveSnapshot(run, session);
  const directRef = findSnapshotRef(snapshot, labels);
  if (directRef) return { framed: false, ref: directRef };

  for (const frame of findHostedPaymentFrames(snapshot, frameLabels)) {
    const switched = await run(
      "agent-browser",
      ["--session", session, "frame", frame.ref],
      { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
    );
    if (switched.exitCode !== 0) continue;

    let shouldRestoreMainFrame = true;
    try {
      const frameSnapshot = await readInteractiveSnapshot(run, session);
      const frameFieldRef =
        findSnapshotRef(frameSnapshot, labels) ??
        (frame.exact ? findFirstTextFieldRef(frameSnapshot) : undefined);
      if (!frameFieldRef) continue;

      shouldRestoreMainFrame = false;
      return { framed: true, ref: frameFieldRef };
    } finally {
      if (shouldRestoreMainFrame) await switchToMainFrame(run, session);
    }
  }
};

type HostedPaymentFrame = {
  readonly exact: boolean;
  readonly ref: string;
};

const findHostedPaymentFrames = (
  snapshot: string,
  frameLabels: readonly string[]
) => {
  const frames = new Map<string, HostedPaymentFrame>();
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref || !/\b(?:frame|iframe)\b/i.test(line)) continue;

    const exact = frameLabels.some((label) =>
      line.toLowerCase().includes(label.toLowerCase())
    );
    frames.set(ref, { exact, ref });
  }

  return [...frames.values()].sort((left, right) =>
    left.exact === right.exact ? 0 : left.exact ? -1 : 1
  );
};

type HostedPaymentClickTarget = {
  readonly value: string;
};

const clickHostedPaymentTarget = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  label: string,
  targets: readonly HostedPaymentClickTarget[],
  options: { readonly optional?: boolean; readonly timeoutMs?: number } = {}
) => {
  const labels = targets.map((target) => target.value);

  try {
    await poll(
      async () => {
        const target = await findHostedPaymentRef(run, session, labels, []);
        if (!target) return;

        try {
          const result = await run(
            "agent-browser",
            ["--session", session, "click", target.ref],
            { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
          );
          if (result.exitCode !== 0) return;

          await Bun.sleep(POLL_INTERVAL_MS);
          const stillPresent = await findHostedPaymentRef(
            run,
            session,
            labels,
            []
          );
          if (stillPresent?.framed) await switchToMainFrame(run, session);
          return stillPresent ? undefined : true;
        } finally {
          if (target.framed) await switchToMainFrame(run, session);
        }
      },
      options.timeoutMs ?? getCheckoutTimeoutMs(),
      `Nexi ${label} action`
    );
  } catch (error) {
    if (options.optional) return;

    const message = error instanceof Error ? error.message : String(error);
    const snapshot = await readInteractiveSnapshot(run, session, true);
    throw new Error(`${message}\n${summarizeHostedPaymentSnapshot(snapshot)}`);
  }
};

const readInteractiveSnapshot = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  allowFailure = false
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "snapshot", "-i"],
    { allowFailure, logOutput: false, timeoutMs: 60_000 }
  );
  if (result.exitCode !== 0) return "";
  return result.stdout;
};

const startBrowserDiagnostics = async (
  run: ReturnType<typeof makeRunner>,
  session: string
) => {
  const commands = [
    ["console", "--clear"],
    ["errors", "--clear"],
    ["network", "requests", "--clear"],
  ];

  for (const args of commands)
    await run("agent-browser", ["--session", session, ...args], {
      allowFailure: true,
      logOutput: false,
      timeoutMs: 30_000,
    });

  const result = await run(
    "agent-browser",
    ["--session", session, "network", "har", "start"],
    { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
  );

  if (result.exitCode !== 0) {
    log("Browser HAR capture unavailable; continuing checkout e2e");
    return false;
  }

  return true;
};

const captureBrowserFailureArtifacts = async ({
  artifactDir,
  cause,
  harStarted,
  run,
  session,
}: {
  artifactDir: string;
  cause: unknown;
  harStarted: boolean;
  run: ReturnType<typeof makeRunner>;
  session: string;
}) => {
  let harStopped = false;

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeTextArtifact(
      artifactDir,
      "error.txt",
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
    );
    await writeTextArtifact(
      artifactDir,
      "browser-diagnostics.txt",
      await readBrowserDiagnostics(run, session)
    );
    await writeCommandArtifact(artifactDir, "network-requests.txt", run, [
      "--session",
      session,
      "network",
      "requests",
    ]);
    await writeCommandArtifact(artifactDir, "console.txt", run, [
      "--session",
      session,
      "console",
    ]);
    await writeCommandArtifact(artifactDir, "errors.txt", run, [
      "--session",
      session,
      "errors",
    ]);
    await writeTextArtifact(
      artifactDir,
      "snapshot-interactive.txt",
      await readInteractiveSnapshot(run, session, true)
    );
    if (harStarted) {
      const rawHarPath = resolve(tmpdir(), `${session}-network.har`);
      harStopped = await stopBrowserHar(run, session, rawHarPath);
      try {
        if (harStopped)
          await writeTextArtifact(
            artifactDir,
            "network.har",
            sanitizeHarArtifact(await readFile(rawHarPath, "utf8"))
          );
      } finally {
        await rm(rawHarPath, { force: true });
      }
    }

    log(`Checkout e2e failure artifacts saved to ${artifactDir}`);
  } catch (error) {
    log(
      `Checkout e2e failure artifact capture failed: ${redact(String(error))}`
    );
  }

  return harStopped;
};

const stopBrowserHar = async (
  run: ReturnType<typeof makeRunner>,
  session: string,
  path?: string
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "network", "har", "stop", ...(path ? [path] : [])],
    { allowFailure: true, logOutput: false, timeoutMs: 60_000 }
  );

  return result.exitCode === 0;
};

const writeCommandArtifact = async (
  artifactDir: string,
  fileName: string,
  run: ReturnType<typeof makeRunner>,
  args: string[]
) => {
  const result = await run("agent-browser", args, {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 60_000,
  });
  const text = [
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : undefined,
    result.stderr ? `stderr:\n${result.stderr}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  await writeTextArtifact(artifactDir, fileName, text);
};

const writeTextArtifact = async (
  artifactDir: string,
  fileName: string,
  text: string
) =>
  writeFile(
    resolve(artifactDir, fileName),
    `${sanitizeArtifactText(text.trim())}\n`
  );

const switchToMainFrame = async (
  run: ReturnType<typeof makeRunner>,
  session: string
) => {
  await run("agent-browser", ["--session", session, "frame", "main"], {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 30_000,
  });
};

const findFirstTextFieldRef = (snapshot: string) => {
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (ref && /\b(textbox|input)\b/i.test(line)) return ref;
  }
};

const summarizeHostedPaymentSnapshot = (snapshot: string) => {
  const lines = snapshot
    .split("\n")
    .filter((line) =>
      /\b(?:button|frame|iframe|input|textbox|link)\b/i.test(line)
    )
    .slice(0, 80)
    .map(sanitizeDiagnosticLine)
    .join("\n");

  return lines
    ? `Nexi HPP snapshot summary:\n${lines}`
    : "Nexi HPP snapshot summary unavailable";
};

const sanitizeDiagnosticLine = (line: string) =>
  redact(line)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[token]");

const sanitizeArtifactText = (text: string) =>
  sanitizeArtifactUrlText(redact(text))
    .replace(/([?&][^=&#\s]+)=[^&\s",}]+/g, "$1=[redacted]")
    .replace(/((?:%3F|%26)[^=%&\s]+)(?:%3D|=)[^%&\s",}]+/gi, "$1%3D[redacted]")
    .replace(/(x-vercel-protection-bypass[=":\s]+)[^&\s",}]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{96,}/g, "[token]");

const sanitizeArtifactUrlText = (text: string) =>
  text.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys())
        url.searchParams.set(key, "[redacted]");
      return url.toString();
    } catch {
      return value;
    }
  });

const sanitizeHarArtifact = (text: string) => {
  try {
    const har = JSON.parse(text) as Record<string, unknown>;
    const log = asRecord(har.log);
    const entries = Array.isArray(log?.entries) ? log.entries : [];

    for (const entry of entries) {
      const record = asRecord(entry);
      if (!record) continue;
      sanitizeHarRequest(asRecord(record.request));
      sanitizeHarResponse(asRecord(record.response));
    }

    return JSON.stringify(har, null, 2);
  } catch {
    return sanitizeArtifactText(text);
  }
};

const sanitizeHarRequest = (request: Record<string, unknown> | undefined) => {
  if (!request) return;
  if (typeof request.url === "string")
    request.url = sanitizeHarUrl(request.url);
  request.headers = sanitizeHarNamedValues(request.headers);
  request.cookies = [];
  request.queryString = sanitizeHarNamedValues(request.queryString);

  const postData = asRecord(request.postData);
  if (!postData) return;
  postData.params = [];
  if (typeof postData.text === "string") postData.text = "[redacted]";
};

const sanitizeHarResponse = (response: Record<string, unknown> | undefined) => {
  if (!response) return;
  response.headers = sanitizeHarNamedValues(response.headers);
  response.cookies = [];

  const content = asRecord(response.content);
  if (content && typeof content.text === "string") content.text = "[redacted]";
};

const sanitizeHarNamedValues = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => {
        const record = asRecord(item);
        return record ? { ...record, value: "[redacted]" } : item;
      })
    : value;

const sanitizeHarUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys())
      url.searchParams.set(key, "[redacted]");
    return sanitizeArtifactText(url.toString());
  } catch {
    return sanitizeArtifactText(value);
  }
};

const asRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const findSnapshotRef = (snapshot: string, labels: readonly string[]) => {
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const name = line
      .match(/"([^"]+)"/)?.[1]
      ?.trim()
      .toLowerCase();
    if (name && labels.some((label) => name === label.toLowerCase()))
      return ref;
  }

  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const lowerLine = line.toLowerCase();
    if (labels.some((label) => lowerLine.includes(label.toLowerCase())))
      return ref;
  }
};

const getSnapshotRef = (line: string) =>
  line.match(/\[ref=(e\d+)\]/)?.[1]?.replace(/^/, "@") ??
  line.match(/@e\d+/)?.[0];

const waitForBrowserUrl = async ({
  description,
  matches,
  run,
  session,
  timeoutMs,
}: {
  description: string;
  matches: (url: string) => boolean;
  run: ReturnType<typeof makeRunner>;
  session: string;
  timeoutMs: number;
}) => {
  try {
    const url = await poll(
      async () => {
        const result = await run(
          "agent-browser",
          ["--session", session, "get", "url"],
          { allowFailure: true, logOutput: false }
        );
        const url = result.stdout.trim();
        return result.exitCode === 0 && matches(url) ? url : undefined;
      },
      timeoutMs,
      description
    );
    log(`Reached ${description}`);
    return url;
  } catch (error) {
    const diagnostics = await readBrowserDiagnostics(run, session);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${diagnostics}`);
  }
};

const readBrowserDiagnostics = async (
  run: ReturnType<typeof makeRunner>,
  session: string
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "eval", "--stdin"],
    {
      allowFailure: true,
      input: browserDiagnosticsScript,
      logOutput: false,
    }
  );

  if (result.exitCode !== 0) return "Browser diagnostics unavailable";
  return `Browser diagnostics:\n${result.stdout}`;
};

const assertFulfilledStatusPage = async ({
  config,
  orderId,
  run,
  session,
}: {
  config: ReturnType<typeof getConfig>;
  orderId: string;
  run: ReturnType<typeof makeRunner>;
  session: string;
}) => {
  const headers = config.bypassSecret
    ? [
        "--headers",
        JSON.stringify({
          "x-vercel-protection-bypass": config.bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }),
      ]
    : [];

  await run(
    "agent-browser",
    [
      "--session",
      session,
      ...headers,
      "open",
      `${config.aliasUrl}/en-US/checkout/status/${orderId}`,
    ],
    { timeoutMs: getCheckoutTimeoutMs() }
  );
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: assertFulfilledStatusScript,
    timeoutMs: getCheckoutTimeoutMs(),
  });
  log("Checkout status page validated");
};

const waitForWebhookReplayRow = async (
  config: ReturnType<typeof getDatasourceConfig>,
  orderId: string,
  onRow?: (row: CheckoutRow) => void
) => {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: getDatasourceTimeoutMs(),
    query_timeout: getDatasourceTimeoutMs(),
    statement_timeout: getDatasourceTimeoutMs(),
  });

  try {
    return await poll(
      async () => {
        const row = await readCheckoutRow(pool, orderId);
        if (row) onRow?.(row);
        return row && isWebhookReplayReady(row) ? row : undefined;
      },
      getDatasourceTimeoutMs(),
      `webhook replay checkout row for ${orderId}`
    );
  } finally {
    await pool.end();
  }
};

const isWebhookReplayReady = (row: CheckoutRow) =>
  !!row.provider_order_id &&
  !!row.security_token &&
  !!row.amount_value &&
  !!row.currency &&
  !!row.payment_attempt_id;

const replayNexiWebhook = async (
  config: ReturnType<typeof getConfig>,
  row: CheckoutRow
) => {
  assert(row.provider_order_id, "provider order id missing before replay");
  assert(row.security_token, "security token missing before replay");
  assert(row.amount_value, "amount missing before replay");
  assert(row.currency, "currency missing before replay");

  const response = await fetch(new URL("/api/webhooks/nexi", config.aliasUrl), {
    body: JSON.stringify({
      eventId: `workspace-e2e-nexi-${row.reservation_id}`,
      eventTime: new Date().toISOString(),
      securityToken: row.security_token,
      operation: {
        orderId: row.provider_order_id,
        operationId:
          row.last_provider_operation_id ??
          `workspace-e2e-${row.reservation_id}`,
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: new Date().toISOString(),
        operationAmount: String(row.amount_value),
        operationCurrency: row.currency,
      },
    }),
    headers: previewWebhookHeaders(config),
    method: "POST",
  });
  assert(response.ok, `Nexi webhook replay failed with ${response.status}`);
  log("Nexi webhook replay accepted");
};

const previewWebhookHeaders = (config: ReturnType<typeof getConfig>) => ({
  "content-type": "application/json",
  ...(config.bypassSecret
    ? { "x-vercel-protection-bypass": config.bypassSecret }
    : {}),
});

const validatePostgres = async (
  config: ReturnType<typeof getDatasourceConfig>,
  data: ReturnType<typeof makeCheckoutData>,
  orderId: string,
  onRow?: (row: CheckoutRow) => void
) => {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: getDatasourceTimeoutMs(),
    query_timeout: getDatasourceTimeoutMs(),
    statement_timeout: getDatasourceTimeoutMs(),
  });

  try {
    const row = await poll(
      async () => {
        const row = await readCheckoutRow(pool, orderId);
        if (row) onRow?.(row);
        return row && isPostgresComplete(row, config) ? row : undefined;
      },
      getDatasourceTimeoutMs(),
      `Postgres checkout rows for ${orderId}`
    );

    assertPostgresRow(row, data, config);
    await assertLegalEvidence(pool, orderId);
    await assertOperationalEvents(pool, orderId, row.payment_attempt_id, data);
    await assertNoLocalPii(
      pool,
      orderId,
      row.payment_attempt_id,
      row.webhook_id,
      data
    );
    log("Postgres checkout tables validated");
    return row;
  } finally {
    await pool.end();
  }
};

const readCheckoutRow = async (pool: Pool, orderId: string) => {
  const result = await pool.query<CheckoutRow>(
    `select
      wr.id as reservation_id,
      wr.correlation_id,
      wr.dotypos_customer_id,
      wr.dotypos_reservation_id,
      wr.reservation_state,
      wr.payment_state,
      wr.fulfillment_state,
      wr.active_payment_attempt_id,
      wr.product_tier,
      wr.product_coffee,
      wr.product_monitor_option,
      wr.locale,
      wr.reservation_created_at,
      wr.reservation_confirmed_at,
      wr.reservation_cancelled_at,
      wr.reservation_hold_expired_at,
      wr.paid_at,
      wr.fulfilled_at,
      wr.fulfillment_failed_at,
      wr.failure_code,
      wr.fulfillment_failure_code,
      pa.id as payment_attempt_id,
      pa.provider,
      pa.provider_order_id,
      pa.security_token,
      pa.state as payment_attempt_state,
      pa.amount_value,
      pa.amount_exponent,
      pa.currency,
      pa.provider_redirect_url,
      pa.last_webhook_event_id,
      pa.last_provider_operation_id,
      pa.last_provider_status,
      pa.failure_code as payment_failure_code,
      wh.id as webhook_id,
      wh.provider as webhook_provider,
      wh.event_id as webhook_event_id,
      wh.provider_order_id as webhook_provider_order_id,
      wh.processed_at as webhook_processed_at,
      wh.state as webhook_state,
      wh.error_code as webhook_error_code
    from workspace_reservations wr
    left join payment_attempts pa on pa.id = wr.active_payment_attempt_id
    left join webhook_events wh on wh.event_id = pa.last_webhook_event_id
    where wr.id = $1`,
    [orderId]
  );
  return result.rows[0];
};

const readCleanupCheckoutRow = async (
  config: ReturnType<typeof getDatasourceConfig>,
  orderId: string
) => {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: getDatasourceTimeoutMs(),
    query_timeout: getDatasourceTimeoutMs(),
    statement_timeout: getDatasourceTimeoutMs(),
  });

  try {
    return await readCheckoutRow(pool, orderId);
  } finally {
    await pool.end();
  }
};

const readLatestCleanupCheckoutRow = async (
  config: ReturnType<typeof getDatasourceConfig>,
  createdAfter: Date
) => {
  const pool = new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: getDatasourceTimeoutMs(),
    query_timeout: getDatasourceTimeoutMs(),
    statement_timeout: getDatasourceTimeoutMs(),
  });

  try {
    const result = await pool.query<{ id: string }>(
      `select wr.id
      from workspace_reservations wr
      where wr.reservation_created_at >= $1
        and wr.dotypos_reservation_id is not null
        and wr.payment_state <> 'paid'
        and wr.product_tier = 'basic'
        and wr.product_coffee = false
        and wr.locale = 'en-US'
      order by wr.reservation_created_at desc
      limit 1`,
      [createdAfter]
    );

    const orderId = result.rows[0]?.id;
    return orderId ? await readCheckoutRow(pool, orderId) : undefined;
  } finally {
    await pool.end();
  }
};

const isPostgresComplete = (
  row: CheckoutRow,
  config: ReturnType<typeof getDatasourceConfig>
) =>
  row.reservation_state === "confirmed" &&
  row.payment_state === "paid" &&
  row.fulfillment_state === "fulfilled" &&
  row.payment_attempt_state === "paid" &&
  row.currency === config.expectedCurrency &&
  row.webhook_state === "processed";

const assertPostgresRow = (
  row: CheckoutRow,
  data: ReturnType<typeof makeCheckoutData>,
  config: ReturnType<typeof getDatasourceConfig>
) => {
  assert(
    row.reservation_id === data.orderIdHint || row.reservation_id,
    "reservation id missing"
  );
  assert(
    row.reservation_state === "confirmed",
    "reservation was not confirmed"
  );
  assert(row.payment_state === "paid", "reservation payment was not paid");
  assert(
    row.fulfillment_state === "fulfilled",
    "reservation fulfillment was not fulfilled"
  );
  assert(row.active_payment_attempt_id, "active payment attempt missing");
  assert(row.dotypos_customer_id, "Dotypos customer id missing");
  assert(row.dotypos_reservation_id, "Dotypos reservation id missing");
  assert(row.reservation_created_at, "reservation_created_at missing");
  assert(row.reservation_confirmed_at, "reservation_confirmed_at missing");
  assert(row.paid_at, "paid_at missing");
  assert(row.fulfilled_at, "fulfilled_at missing");
  assert(
    row.reservation_cancelled_at === null,
    "reservation_cancelled_at should be null"
  );
  assert(
    row.reservation_hold_expired_at === null,
    "reservation_hold_expired_at should be null"
  );
  assert(
    row.fulfillment_failed_at === null,
    "fulfillment_failed_at should be null"
  );
  assert(row.failure_code === null, "reservation failure_code should be null");
  assert(
    row.fulfillment_failure_code === null,
    "fulfillment_failure_code should be null"
  );
  assert(row.product_tier === "basic", "unexpected product tier");
  assert(
    row.product_coffee === false,
    "coffee should be off for this happy path"
  );
  assert(
    row.product_monitor_option === null,
    "monitor option should be null for basic tier"
  );
  assert(row.locale === "en-US", "unexpected locale");
  assert(
    row.payment_attempt_id === row.active_payment_attempt_id,
    "active attempt mismatch"
  );
  assert(row.provider === "nexi", "payment provider should be nexi");
  assert(row.provider_order_id, "provider order id missing");
  assert(row.security_token, "security token missing");
  assert(row.payment_attempt_state === "paid", "payment attempt was not paid");
  assert(row.amount_value && row.amount_value > 0, "payment amount missing");
  assert(row.amount_exponent !== null, "payment amount exponent missing");
  assert(
    row.currency === config.expectedCurrency,
    `expected ${config.expectedCurrency} currency`
  );
  assert(row.provider_redirect_url, "provider redirect URL missing");
  assert(row.last_webhook_event_id, "last webhook event id missing");
  assert(row.last_provider_operation_id, "last provider operation id missing");
  assert(
    row.last_provider_status === "EXECUTED",
    "last provider status was not EXECUTED"
  );
  assert(
    row.payment_failure_code === null,
    "payment failure code should be null"
  );
  assert(row.webhook_id, "webhook id missing");
  assert(
    row.webhook_event_id === row.last_webhook_event_id,
    "webhook event id mismatch"
  );
  assert(row.webhook_provider === "nexi", "webhook provider should be nexi");
  assert(
    row.webhook_provider_order_id === row.provider_order_id,
    "webhook order id mismatch"
  );
  assert(row.webhook_processed_at, "webhook processed_at missing");
  assert(row.webhook_state === "processed", "webhook was not processed");
  assert(row.webhook_error_code === null, "webhook error code should be null");
};

const assertLegalEvidence = async (pool: Pool, orderId: string) => {
  const result = await pool.query<{
    accepted: boolean;
    document_key: string;
    hash_algorithm: string;
    locale: string;
    source: string;
  }>(
    `select document_key, source, accepted, hash_algorithm, locale
    from legal_evidence_events
    where workspace_reservation_id = $1`,
    [orderId]
  );

  const expected = new Set([
    "privacyPolicy:reservation_submit",
    "termsAndConditions:payment_submit",
    "operatingRules:payment_submit",
  ]);

  for (const row of result.rows) {
    assert(row.accepted, `legal evidence ${row.document_key} was not accepted`);
    assert(
      row.hash_algorithm === "sha256",
      "legal evidence hash algorithm mismatch"
    );
    assert(row.locale === "en-US", "legal evidence locale mismatch");
    expected.delete(`${row.document_key}:${row.source}`);
  }

  assert(
    expected.size === 0,
    `missing legal evidence rows: ${[...expected].join(", ")}`
  );
};

const assertOperationalEvents = async (
  pool: Pool,
  orderId: string,
  paymentAttemptId: string | null,
  data: ReturnType<typeof makeCheckoutData>
) => {
  const errors = await pool.query<{ count: string }>(
    `select count(*)
    from operational_events
    where severity = 'error'
      and (workspace_reservation_id = $1 or payment_attempt_id = $2)`,
    [orderId, paymentAttemptId]
  );
  assert(
    Number(errors.rows[0]?.count ?? 0) === 0,
    "error operational events found"
  );

  const pii = await pool.query<{ count: string }>(
    `select count(*)
    from operational_events
    where workspace_reservation_id = $1
      and (message ilike $2 or message ilike $3 or message ilike $4)`,
    [orderId, `%${data.email}%`, `%${data.phone}%`, `%${data.name}%`]
  );
  assert(
    Number(pii.rows[0]?.count ?? 0) === 0,
    "operational event messages contain test PII"
  );
};

const assertNoLocalPii = async (
  pool: Pool,
  orderId: string,
  paymentAttemptId: string | null,
  webhookEventId: string | null,
  data: ReturnType<typeof makeCheckoutData>
) => {
  const result = await pool.query<{ count: string }>(
    `with payloads as (
      select to_jsonb(wr)::text as payload
      from workspace_reservations wr
      where wr.id = $1
      union all
      select to_jsonb(pa)::text
      from payment_attempts pa
      where pa.id = $2
      union all
      select to_jsonb(wh)::text
      from webhook_events wh
      where wh.id = $3
      union all
      select to_jsonb(le)::text
      from legal_evidence_events le
      where le.workspace_reservation_id = $1
      union all
      select to_jsonb(oe)::text
      from operational_events oe
      where oe.workspace_reservation_id = $1 or oe.payment_attempt_id = $2
    )
    select count(*)
      from payloads
      where payload ilike $4 or payload ilike $5 or payload ilike $6 or payload ilike $7`,
    [
      orderId,
      paymentAttemptId,
      webhookEventId,
      `%${data.email}%`,
      `%${data.phone}%`,
      `%${data.name}%`,
      `%${data.message}%`,
    ]
  );

  assert(
    Number(result.rows[0]?.count ?? 0) === 0,
    "local checkout tables contain test PII"
  );
};

const validateDotypos = async (
  config: ReturnType<typeof getDatasourceConfig>,
  data: ReturnType<typeof makeCheckoutData>,
  row: CheckoutRow
) => {
  assert(
    row.dotypos_reservation_id,
    "Dotypos reservation id missing before validation"
  );
  assert(
    row.dotypos_customer_id,
    "Dotypos customer id missing before validation"
  );
  const dotyposReservationId = row.dotypos_reservation_id;

  const layer = DotyposService.Default.pipe(
    Layer.provide(
      Layer.succeed(DotyposRuntimeConfig, {
        apiTimeout: config.dotypos.apiTimeout,
        apiUrl: config.dotypos.apiUrl,
        branchId: config.dotypos.branchId,
        clientId: config.dotypos.clientId,
        clientSecret: config.dotypos.clientSecret,
        cloudId: config.dotypos.cloudId,
        employeeId: config.dotypos.employeeId,
        refreshToken: config.dotypos.refreshToken,
        reservationTableIds: [],
      })
    )
  );

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      return yield* dotypos.getReservation(dotyposReservationId);
    }).pipe(Effect.provide(layer))
  );

  assert(
    result.reservation.status === "CONFIRMED",
    "Dotypos reservation is not confirmed"
  );
  assert(
    result.reservation._customerId === row.dotypos_customer_id,
    "Dotypos customer mismatch"
  );
  assert(result.reservation._tableId, "Dotypos table id missing");
  assert(
    result.reservation.seats === "1",
    "Dotypos reservation seats should be 1"
  );
  assert(
    result.reservation.note?.includes(row.reservation_id),
    "Dotypos note missing workspace order id"
  );
  assert(
    dotyposDateCovers(
      result.reservation.startDate,
      result.reservation.endDate,
      data.date
    ),
    "Dotypos date does not cover selected checkout date"
  );
  log("Dotypos reservation state validated");
};

const cancelDotyposReservation = async (
  config: ReturnType<typeof getDatasourceConfig>,
  dotyposReservationId: string
) => {
  const layer = DotyposService.Default.pipe(
    Layer.provide(
      Layer.succeed(DotyposRuntimeConfig, {
        apiTimeout: config.dotypos.apiTimeout,
        apiUrl: config.dotypos.apiUrl,
        branchId: config.dotypos.branchId,
        clientId: config.dotypos.clientId,
        clientSecret: config.dotypos.clientSecret,
        cloudId: config.dotypos.cloudId,
        employeeId: config.dotypos.employeeId,
        refreshToken: config.dotypos.refreshToken,
        reservationTableIds: [],
      })
    )
  );

  await Effect.runPromise(
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      yield* dotypos.cancelReservation(dotyposReservationId);
    }).pipe(Effect.provide(layer))
  );
  log("Dotypos reservation cancelled after validation");
};

const assertSafeDatabaseUrl = (databaseUrl: string, label: string) => {
  const allowlist = requireEnv("WORKSPACE_E2E_DATABASE_ALLOWLIST")
    .split(",")
    .map((value) => value.trim())
    .map(databaseAllowlistKey)
    .filter(Boolean);
  assert(
    allowlist.includes(databaseSafetyKey(databaseUrl)),
    `${label} is not allowlisted for workspace checkout e2e`
  );
};

const databaseSafetyKey = (databaseUrl: string) => {
  const url = new URL(normalizePostgresConnectionUrl(databaseUrl));
  return databaseKeyFromHostPath(url.hostname, url.pathname);
};

const databaseAllowlistKey = (value: string) => {
  if (!value) return value;
  if (value.includes("://")) return databaseSafetyKey(value);
  const slashIndex = value.indexOf("/");
  if (slashIndex === -1) return databaseKeyFromHostPath(value, "");
  return databaseKeyFromHostPath(
    value.slice(0, slashIndex),
    value.slice(slashIndex)
  );
};

const databaseKeyFromHostPath = (hostname: string, pathname: string) => {
  const [firstLabel, ...rest] = hostname.split(".");
  const normalizedFirstLabel =
    hostname.endsWith(".neon.tech") && firstLabel?.endsWith("-pooler")
      ? firstLabel.slice(0, -"-pooler".length)
      : firstLabel;
  return `${[normalizedFirstLabel, ...rest].join(".")}${pathname}`;
};

const writeVercelProjectLink = async (config: ReturnType<typeof getConfig>) => {
  const file = resolve(repoRoot, ".vercel/project.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ orgId: config.vercelTeamId, projectId: config.vercelProjectId }, null, 2)}\n`
  );
};

const getDeployment = async (
  config: ReturnType<typeof getConfig>,
  previewUrl: string
) => {
  const host = new URL(previewUrl).host;
  const response = await vercelFetch(config, `/v13/deployments/${host}`);
  const body = (await response.json()) as { id?: unknown };
  assert(
    typeof body.id === "string",
    "Vercel deployment response did not include id"
  );
  log(`Fresh Vercel deployment ${body.id} at ${previewUrl}`);
  return { id: body.id as string };
};

const recordAliasPreflight = async (
  config: ReturnType<typeof getConfig>,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v13/deployments/${config.alias}`,
    {},
    { allowFailure: true }
  );
  if (!response.ok) {
    log(`${config.alias} currently has no readable deployment target`);
    return true;
  }

  const body = (await response.json()) as { id?: unknown };
  if (body.id === deploymentId) {
    log(`${config.alias} already points at the fresh deployment`);
    return false;
  }

  if (typeof body.id === "string") {
    log(
      `${config.alias} currently points at ${body.id}; it will be left on the fresh deployment for webhook stability`
    );
  }
  return true;
};

const assignAlias = async (
  config: ReturnType<typeof getConfig>,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v2/deployments/${deploymentId}/aliases`,
    {
      body: JSON.stringify({ alias: config.alias }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok)
    throw new Error(`Vercel alias assignment failed: ${response.status}`);
  log(`Assigned ${config.aliasUrl} to fresh deployment`);
};

const verifyAlias = async (
  config: ReturnType<typeof getConfig>,
  deploymentId: string
) => {
  const response = await vercelFetch(
    config,
    `/v13/deployments/${config.alias}`
  );
  const body = (await response.json()) as { id?: unknown };
  assert(
    body.id === deploymentId,
    `${config.alias} does not point at fresh deployment`
  );
  log("Vercel alias target verified");
};

const assertWebhookEndpoint = async (
  config: ReturnType<typeof getConfig>,
  path: string
) => {
  const url = new URL(path, config.aliasUrl);
  if (config.bypassSecret)
    url.searchParams.set("x-vercel-protection-bypass", config.bypassSecret);

  const response = await fetch(url);
  assert(response.ok, `${path} health check failed with ${response.status}`);
};

const vercelFetch = async (
  config: ReturnType<typeof getConfig>,
  path: string,
  init: RequestInit = {},
  options: { readonly allowFailure?: boolean } = {}
) => {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.vercel.com${path}${separator}teamId=${config.vercelTeamId}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${config.vercelToken}`,
        ...init.headers,
      },
    }
  );
  if (!response.ok && !options.allowFailure)
    throw new Error(`Vercel API ${path} failed with ${response.status}`);
  return response;
};

const makeCheckoutData = (aliasUrl: string, date: string) => {
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const name = `Workspace E2E ${runId}`;
  const phone = `+420735${runId.slice(6, 12)}`;
  const email = "delivered@resend.dev";
  const message = `Automated checkout e2e ${runId}`;
  const params = new URLSearchParams({
    coffee: "false",
    date,
    email,
    entryTier: "basic",
    message,
    name,
    phone,
  });

  return {
    checkoutUrl: `${aliasUrl}/en-US/checkout/order?${params}`,
    date,
    email,
    message,
    name,
    orderIdHint: "",
    phone,
  };
};

const selectAvailableCheckoutDate = async (
  config: ReturnType<typeof getConfig>
) => {
  const from = futureIsoDate(14);
  const to = futureIsoDate(90);
  const params = new URLSearchParams({ entryTier: "basic", from, to });
  const response = await fetch(
    `${config.aliasUrl}/api/workspace/availability?${params}`,
    {
      headers: config.bypassSecret
        ? { "x-vercel-protection-bypass": config.bypassSecret }
        : undefined,
    }
  );
  assert(response.ok, `availability check failed with ${response.status}`);

  const availability = (await response.json()) as {
    readonly unavailableDates?: unknown;
  };
  assert(
    Array.isArray(availability.unavailableDates),
    "availability response missing unavailableDates"
  );
  const unavailable = new Set(
    availability.unavailableDates.filter(
      (date): date is string => typeof date === "string"
    )
  );

  for (let offset = 14; offset <= 90; offset += 1) {
    const date = futureIsoDate(offset);
    if (!isWeekday(date) || unavailable.has(date)) continue;
    log(`Selected available checkout date ${date}`);
    return date;
  }

  throw new Error("No available checkout date found");
};

const futureIsoDate = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const isWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

const extractDeploymentUrl = (stdout: string) => {
  const urls = stdout.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? [];
  const url = urls.at(-1);
  assert(url, "could not find Vercel preview URL in deploy output");
  return url;
};

const extractOrderId = (stdout: string) => {
  const match = stdout.match(/\/checkout\/status\/([^\s/?#]+)/);
  assert(match?.[1], "could not extract checkout status order id");
  return match[1];
};

const getSearchOrderId = (value: string | undefined) => {
  if (!value) return undefined;
  const url = parseUrl(value);
  return url?.searchParams.get("orderId") ?? undefined;
};

const dotyposDateCovers = (
  start: string,
  end: string,
  expectedDate: string
) => {
  const selected = new Date(`${expectedDate}T12:00:00.000Z`).getTime();
  return (
    parseDotyposTimestamp(start) <= selected &&
    selected <= parseDotyposTimestamp(end)
  );
};

const parseDotyposTimestamp = (value: string) =>
  /^\d+$/.test(value) ? Number(value) : new Date(value).getTime();

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const poll = async <T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  label: string
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const loadEnvFile = async (path: string) => {
  const values = new Map<string, string>();
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return values;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = unquoteEnv(trimmed.slice(equals + 1).trim());
    values.set(key, value);
    if (!env(key)) process.env[key] = value;
  }

  return values;
};

const unquoteEnv = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replaceAll("\\n", "\n");
  }
  return value;
};

const requireEnv = (name: string) => {
  const value = env(name);
  assert(value, `${name} is required for workspace checkout e2e`);
  addRedaction(value);
  return value;
};

const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const addRedaction = (value: string | undefined, force = false) => {
  if (!value || (!force && value.length <= 6)) return;
  redactions.add(value);
  redactions.add(encodeURIComponent(value));
  redactions.add(
    new URLSearchParams({ value }).toString().slice("value=".length)
  );
};

const redact = (text: string) => {
  let output = text;
  for (const secret of redactions)
    output = output.replaceAll(secret, "[redacted]");
  return output;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const log = (message: string) => process.stdout.write(`${redact(message)}\n`);

const submitReservationScript = `
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  let checkbox;
  await waitUntil(() => {
    const candidate = document.querySelector('#reservation-privacy-consent');
    if (candidate instanceof HTMLButtonElement) {
      checkbox = candidate;
      return true;
    }
    return false;
  }, 'privacy consent checkbox not found');
  if (checkbox.getAttribute('aria-checked') !== 'true') (checkbox.closest('label') ?? checkbox).click();
  await waitUntil(() => checkbox.getAttribute('aria-checked') === 'true', 'privacy consent checkbox did not check');
  const form = checkbox.closest('form') ?? document.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('reservation form not found');
  const button = form.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('reservation submit button not found');
  await waitUntil(() => !button.disabled, 'reservation submit button stayed disabled');
  setTimeout(() => button.click(), 0);
  return location.href;
})()
`;

const submitPaymentScript = String.raw`
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  const isChecked = (element) =>
    element instanceof HTMLInputElement
      ? element.checked
      : element.getAttribute('aria-checked') === 'true' || element.getAttribute('data-state') === 'checked';
  const checkbox = document.querySelector('#checkout-pay-legal-consent');
  if (!(checkbox instanceof HTMLElement)) throw new Error('payment consent checkbox not found');
  if (!isChecked(checkbox)) checkbox.click();
  await waitUntil(() => isChecked(checkbox), 'payment consent checkbox did not check');
  const button = [...document.querySelectorAll('button')].find((candidate) => /order\s+and\s+pay/i.test(candidate.textContent ?? ''));
  if (!(button instanceof HTMLButtonElement)) throw new Error('order and pay button not found');
  await waitUntil(() => !button.disabled, 'order and pay button stayed disabled');
  setTimeout(() => button.click(), 0);
  return location.href;
})()
`;

const payPageOrderIdScript = `
(() => {
  const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = (document.body?.innerText ?? '').match(idPattern);
  return match?.[0] ?? '';
})()
`;

const browserDiagnosticsScript = String.raw`
(() => {
  const cleanUrl = (value) => {
    try {
      const url = new URL(value);
      for (const key of ['payState', 'checkoutToken', '_vercel_share', 'x-vercel-protection-bypass']) {
        if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.toString();
    } catch {
      return '[unavailable]';
    }
  };
  const submit = document.querySelector('button[type="submit"]');
  const alerts = [...document.querySelectorAll('[role="alert"]')]
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    alerts,
    body: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1200),
    submitDisabled: submit instanceof HTMLButtonElement ? submit.disabled : null,
    submitText: submit?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    title: document.title,
    url: cleanUrl(location.href),
  };
})()
`;

const assertFulfilledStatusScript = String.raw`
(() => {
  const text = document.body?.textContent ?? '';
  if (!/Your workspace access is ready\./i.test(text) || !/sent by email/i.test(text)) {
    throw new Error('fulfilled checkout status copy not visible');
  }
  return location.href;
})()
`;

main().catch((error) => {
  process.stderr.write(
    `${redact(error instanceof Error ? (error.stack ?? error.message) : String(error))}\n`
  );
  process.exit(1);
});

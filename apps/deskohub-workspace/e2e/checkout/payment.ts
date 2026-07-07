import {
  findFirstTextFieldRef,
  findSnapshotRef,
  getSnapshotRef,
  openBrowserPage,
  readBrowserUrl,
  readInteractiveSnapshot,
  summarizeHostedPaymentSnapshot,
  switchToMainFrame,
  waitForBrowserUrl,
} from "../browser";
import { payPageOrderIdScript, submitPaymentScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import type { Runner } from "../runtime";
import {
  addRedaction,
  assert,
  log,
  POLL_INTERVAL_MS,
  parseUrl,
  poll,
} from "../runtime";
import type { CheckoutData } from "../types";

const NEXI_TEST_CARD_NUMBER = "4509034543615006";
const NEXI_TEST_CVV = "298";
const NEXI_TEST_EXPIRY = "1028";

export const completeCheckout = async ({
  config,
  data,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
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

export const startCheckoutPaymentAttempt = async ({
  config,
  data,
  onOrderId,
  run,
  session,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  onOrderId?: (orderId: string) => void;
  run: Runner;
  session: string;
  submitReservationScript: string;
}) => {
  await openBrowserPage(config, run, session, data.checkoutUrl, {
    timeoutMs: getCheckoutTimeoutMs(),
  });
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: submitReservationScript,
    logOutput: false,
  });
  const payPageUrl = await waitForBrowserUrl({
    description: "checkout pay page",
    matches: (url) => url.includes("/checkout/pay"),
    run,
    session,
    timeoutMs: getCheckoutTimeoutMs(),
  });
  const orderId =
    getSearchOrderId(payPageUrl) ?? (await readPayPageOrderId(run, session));
  onOrderId?.(orderId);
  await submitPaymentAndWaitForHostedPage({ run, session });
  log(`Started hosted payment attempt for order ${orderId}`);
  return orderId;
};

const readPayPageOrderId = async (run: Runner, session: string) => {
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

const isCheckoutStatusUrl = (url: string | undefined) =>
  parseUrl(url ?? "")?.pathname.includes("/checkout/status/") ?? false;

const submitPaymentAndWaitForHostedPage = async ({
  run,
  session,
}: {
  run: Runner;
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
  data: CheckoutData;
  run: Runner;
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
  run: Runner,
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
  run: Runner,
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
  run: Runner,
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
  run: Runner,
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
  run: Runner,
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

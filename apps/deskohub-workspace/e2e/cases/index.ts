import { devNull } from "node:os";
import { resolve } from "node:path";
import {
  captureBrowserFailureArtifacts,
  startBrowserDiagnostics,
  stopBrowserHar,
} from "../browser";
import {
  checkoutFlows,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectAvailableCoworkDates,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  readCleanupCheckoutRow,
  readLatestCleanupCheckoutRow,
} from "../integrations/database";
import { cancelDotyposReservation } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { addRedaction, log, redact } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { assertContactForm } from "./contact";
import { assertLocaleSwitcher } from "./locale";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";

export const makeWorkspaceE2ECases = async ({
  config,
  datasourceConfig,
  deploymentId,
  flowStates,
  run,
}: {
  config: WorkspaceE2EConfig;
  datasourceConfig: DatasourceConfig;
  deploymentId: string;
  flowStates: CheckoutFlowState[];
  run: Runner;
}): Promise<readonly WorkspaceE2ECase[]> => {
  const terminalScenarios = getPaymentTerminalScenarios();
  const checkoutDates = await selectAvailableCoworkDates(
    config,
    checkoutFlows.length + terminalScenarios.length
  );
  const cases: WorkspaceE2ECase[] = [
    {
      execute: ({ session }) => assertLocaleSwitcher({ config, run, session }),
      id: "locale-switch",
    },
    {
      execute: ({ session }) => assertContactForm({ config, run, session }),
      id: "contact-form",
    },
  ];
  let nextDateIndex = 0;

  for (const scenario of terminalScenarios) {
    const data = makeCoworkCheckoutData(
      config.aliasUrl,
      requireCheckoutDate(checkoutDates, nextDateIndex),
      `cowork-${scenario.state}`
    );
    nextDateIndex += 1;
    const state = trackCheckoutState(flowStates, data);
    cases.push({
      execute: ({ session }) =>
        assertPaymentTerminalPath({
          config,
          data,
          datasourceConfig,
          run,
          scenario,
          session,
          state,
        }),
      id: `payment-${scenario.state}`,
    });
  }

  for (const flow of checkoutFlows) {
    const data = await flow.makeData(
      config,
      datasourceConfig,
      requireCheckoutDate(checkoutDates, nextDateIndex)
    );
    nextDateIndex += 1;
    if (!data) {
      log(`${flow.id} checkout e2e skipped`);
      continue;
    }

    const state = trackCheckoutState(flowStates, data);
    cases.push({
      execute: ({ session }) =>
        executeCheckoutFlow({
          config,
          data,
          datasourceConfig,
          deploymentId,
          flow,
          run,
          session,
          state,
        }),
      id: `checkout-${flow.id}`,
    });
  }

  return cases;
};

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  for (const value of [
    data.checkoutUrl,
    data.email,
    data.message,
    data.name,
    data.phone,
  ])
    addRedaction(value);
  return state;
};

export const runWorkspaceE2ECases = async ({
  artifactRoot,
  cases,
  run,
  sessionPrefix,
}: {
  artifactRoot: string;
  cases: readonly WorkspaceE2ECase[];
  run: Runner;
  sessionPrefix: string;
}) => {
  log(
    `Running ${cases.length} workspace e2e cases in parallel: ${cases
      .map((testCase) => testCase.id)
      .join(", ")}`
  );

  const results = await Promise.allSettled(
    cases.map((testCase) =>
      runWorkspaceE2ECase({ artifactRoot, run, sessionPrefix, testCase })
    )
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ cause: result.reason, id: cases[index]?.id ?? `case-${index}` }]
      : []
  );

  if (failures.length === 0) return;

  throw new AggregateError(
    failures.map((failure) => failure.cause),
    `Workspace e2e cases failed: ${failures
      .map((failure) => failure.id)
      .join(", ")}`
  );
};

const runWorkspaceE2ECase = async ({
  artifactRoot,
  run,
  sessionPrefix,
  testCase,
}: {
  artifactRoot: string;
  run: Runner;
  sessionPrefix: string;
  testCase: WorkspaceE2ECase;
}) => {
  const session = `${sessionPrefix}-${testCase.id}`;
  const artifactDir = resolve(artifactRoot, testCase.id);
  let browserHarStarted = false;
  let browserHarStopped = false;

  log(`Starting ${testCase.id} e2e case`);
  try {
    browserHarStarted = await startBrowserDiagnostics(run, session);
    await testCase.execute({ session });
    log(`${testCase.id} e2e case passed`);
  } catch (cause) {
    browserHarStopped = await captureBrowserFailureArtifacts({
      artifactDir,
      cause,
      harStarted: browserHarStarted,
      run,
      session,
    });
    throw cause;
  } finally {
    if (browserHarStarted && !browserHarStopped)
      await stopBrowserHar(run, session, devNull);
    await run("agent-browser", ["--session", session, "close"], {
      allowFailure: true,
      logOutput: false,
    });
  }
};

export const cleanupCheckoutFlowStates = async ({
  datasourceConfig,
  flowStates,
  workflowError,
}: {
  datasourceConfig: DatasourceConfig | undefined;
  flowStates: readonly CheckoutFlowState[];
  workflowError: unknown;
}) => {
  let cleanupError: unknown;

  for (const state of flowStates) {
    if (
      datasourceConfig &&
      !state.checkoutRow?.dotypos_reservation_id &&
      state.orderId
    ) {
      try {
        state.checkoutRow = await readCleanupCheckoutRow(
          datasourceConfig,
          state.orderId
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(`Dotypos cleanup row lookup failed: ${redact(String(cause))}`);
      }
    }
    if (
      datasourceConfig &&
      !state.checkoutRow?.dotypos_reservation_id &&
      state.startedAt
    ) {
      try {
        state.checkoutRow = await readLatestCleanupCheckoutRow(
          datasourceConfig,
          state.startedAt,
          state.data
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(
            `Dotypos fallback cleanup row lookup failed: ${redact(String(cause))}`
          );
      }
    }
    if (datasourceConfig && state.checkoutRow?.dotypos_reservation_id) {
      try {
        await cancelDotyposReservation(
          datasourceConfig,
          state.checkoutRow.dotypos_reservation_id
        );
      } catch (cause) {
        cleanupError = cause;
        if (workflowError)
          log(`Dotypos cleanup failed: ${redact(String(cause))}`);
      }
    }
  }

  return cleanupError;
};

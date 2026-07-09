import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import {
  captureBrowserFailureArtifacts,
  closeBrowserSession,
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
  failWorkspaceE2E,
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  readCleanupCheckoutRow,
  readLatestCleanupCheckoutRow,
} from "../integrations/database";
import { cancelDotyposReservation } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { log, redact } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
  WorkspaceE2EResourceScope,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { assertContactForm } from "./contact";
import { assertLocaleSwitcher } from "./locale";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";

export const makeWorkspaceE2ECases = ({
  config,
  datasourceConfig,
  deploymentId,
  flowStates,
  resources,
  run,
}: {
  config: WorkspaceE2EConfig;
  datasourceConfig: DatasourceConfig;
  deploymentId: string;
  flowStates: CheckoutFlowState[];
  resources: WorkspaceE2EResourceScope;
  run: Runner;
}): Effect.Effect<readonly WorkspaceE2ECase[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const terminalScenarios = getPaymentTerminalScenarios();
    const coworkCheckoutFlowCount = checkoutFlows.filter(
      (flow) => flow.usesCoworkDate
    ).length;
    const checkoutDates = yield* selectAvailableCoworkDates(
      config,
      coworkCheckoutFlowCount + terminalScenarios.length
    );
    const cases: WorkspaceE2ECase[] = [
      {
        execute: ({ session }) =>
          assertLocaleSwitcher({ config, run, session }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run locale switch e2e case", cause)
            )
          ),
        id: "locale-switch",
      },
      {
        execute: ({ session }) =>
          assertContactForm({ config, run, session }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run contact form e2e case", cause)
            )
          ),
        id: "contact-form",
      },
    ];
    let nextDateIndex = 0;
    let checkoutFlowProviderSessionCount = 0;

    for (const scenario of terminalScenarios) {
      const date = yield* requireCheckoutDate(checkoutDates, nextDateIndex);
      const data = makeCoworkCheckoutData(
        config.browserUrl,
        date,
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
            resources,
            run,
            scenario,
            session,
            state,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                `run ${scenario.state} payment e2e case`,
                cause
              )
            )
          ),
        id: `payment-${scenario.state}`,
      });
    }

    for (const flow of checkoutFlows) {
      const date = flow.usesCoworkDate
        ? yield* requireCheckoutDate(checkoutDates, nextDateIndex)
        : "";
      const data = yield* flow.makeData(config, datasourceConfig, date);
      if (flow.usesCoworkDate) nextDateIndex += 1;
      if (!data) {
        log(`${flow.id} checkout e2e skipped`);
        continue;
      }

      const state = trackCheckoutState(flowStates, data);
      checkoutFlowProviderSessionCount += 1;
      cases.push({
        execute: ({ session }) =>
          executeCheckoutFlow({
            config,
            data,
            datasourceConfig,
            deploymentId,
            flow,
            resources,
            run,
            session,
            state,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(`run ${flow.id} checkout e2e case`, cause)
            )
          ),
        id: `checkout-${flow.id}`,
      });
    }

    yield* resources.expectCheckoutFlowProviderSessions(
      checkoutFlowProviderSessionCount
    );

    return cases;
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};

export const runWorkspaceE2ECases = ({
  artifactRoot,
  cases,
  run,
  sessionPrefix,
}: {
  artifactRoot: string;
  cases: readonly WorkspaceE2ECase[];
  run: Runner;
  sessionPrefix: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    log(
      `Running ${cases.length} workspace e2e cases in parallel: ${cases
        .map((testCase) => testCase.id)
        .join(", ")}`
    );

    const results = yield* Effect.all(
      cases.map((testCase) =>
        Effect.exit(
          runWorkspaceE2ECase({ artifactRoot, run, sessionPrefix, testCase })
        )
      ),
      { concurrency: "unbounded" }
    );
    const failures = results.flatMap((result, index) =>
      Exit.isFailure(result)
        ? [
            {
              cause: Cause.squash(result.cause),
              id: cases[index]?.id ?? `case-${index}`,
            },
          ]
        : []
    );

    if (failures.length === 0) return;

    return yield* failWorkspaceE2E(
      `Workspace e2e cases failed: ${failures
        .map((failure) => failure.id)
        .join(", ")}`,
      {
        causes: failures.map((failure) => failure.cause),
        operation: "run workspace e2e cases",
      }
    );
  });

const runWorkspaceE2ECase = ({
  artifactRoot,
  run,
  sessionPrefix,
  testCase,
}: {
  artifactRoot: string;
  run: Runner;
  sessionPrefix: string;
  testCase: WorkspaceE2ECase;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const session = `${sessionPrefix}-${testCase.id}`;
    const artifactDir = resolve(artifactRoot, testCase.id);
    let artifactCaptureError: WorkspaceE2EError | undefined;
    let browserHarStarted = false;
    let browserHarStopped = false;

    log(`Starting ${testCase.id} e2e case`);
    const executionExit = yield* Effect.exit(
      Effect.gen(function* () {
        browserHarStarted = yield* startBrowserDiagnostics(run, session);
        yield* testCase.execute({ session });
        log(`${testCase.id} e2e case passed`);
      })
    );

    if (Exit.isFailure(executionExit)) {
      const cause = Cause.squash(executionExit.cause);
      const artifactCaptureExit = yield* Effect.exit(
        captureBrowserFailureArtifacts({
          artifactDir,
          cause,
          harStarted: browserHarStarted,
          run,
          session,
        })
      );
      if (Exit.isSuccess(artifactCaptureExit)) {
        browserHarStopped = artifactCaptureExit.value;
      } else {
        artifactCaptureError = toWorkspaceE2EError(
          `${testCase.id} browser failure artifact capture`,
          Cause.squash(artifactCaptureExit.cause)
        );
      }
    }

    const finalizerErrors: WorkspaceE2EError[] = [];
    if (browserHarStarted && !browserHarStopped) {
      const stopHarExit = yield* Effect.exit(
        stopBrowserHar(run, session, devNull)
      );
      if (Exit.isFailure(stopHarExit))
        finalizerErrors.push(
          toWorkspaceE2EError(
            `${testCase.id} e2e HAR finalizer`,
            Cause.squash(stopHarExit.cause)
          )
        );
    }
    const closeBrowserExit = yield* Effect.exit(
      closeBrowserSession(run, session)
    );
    if (Exit.isFailure(closeBrowserExit))
      finalizerErrors.push(
        toWorkspaceE2EError(
          `${testCase.id} e2e browser close finalizer`,
          Cause.squash(closeBrowserExit.cause)
        )
      );

    const finalizerError =
      finalizerErrors.length === 0
        ? undefined
        : workspaceE2EError(`${testCase.id} e2e finalizer failed`, {
            causes: finalizerErrors,
            operation: `${testCase.id} e2e finalizer`,
          });

    if (Exit.isFailure(executionExit)) {
      const executionError = toWorkspaceE2EError(
        `${testCase.id} e2e case`,
        Cause.squash(executionExit.cause)
      );
      const causes = [
        executionError,
        artifactCaptureError,
        finalizerError,
      ].filter((cause): cause is WorkspaceE2EError => cause !== undefined);

      if (causes.length > 1)
        return yield* failWorkspaceE2E(
          `${testCase.id} e2e case failed with auxiliary errors`,
          {
            causes,
            operation: `${testCase.id} e2e case`,
          }
        );

      return yield* Effect.fail(executionError);
    }

    if (finalizerError) return yield* Effect.fail(finalizerError);
  });

export const cleanupCheckoutFlowStates = ({
  datasourceConfig,
  flowStates,
  workflowError,
}: {
  datasourceConfig: DatasourceConfig | undefined;
  flowStates: readonly CheckoutFlowState[];
  workflowError: unknown;
}): Effect.Effect<WorkspaceE2EError | undefined, never> =>
  Effect.gen(function* () {
    let cleanupError: WorkspaceE2EError | undefined;

    for (const state of flowStates) {
      if (
        datasourceConfig &&
        !state.checkoutRow?.dotypos_reservation_id &&
        state.orderId
      ) {
        const orderId = state.orderId;
        const rowExit = yield* Effect.exit(
          readCleanupCheckoutRow(datasourceConfig, orderId)
        );
        if (Exit.isSuccess(rowExit)) {
          state.checkoutRow = rowExit.value;
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupError = toWorkspaceE2EError(
            "read checkout cleanup row",
            cause
          );
          if (workflowError)
            log(`Dotypos cleanup row lookup failed: ${redact(String(cause))}`);
        }
      }
      if (
        datasourceConfig &&
        !state.checkoutRow?.dotypos_reservation_id &&
        state.startedAt
      ) {
        const startedAt = state.startedAt;
        const rowExit = yield* Effect.exit(
          readLatestCleanupCheckoutRow(datasourceConfig, startedAt, state.data)
        );
        if (Exit.isSuccess(rowExit)) {
          state.checkoutRow = rowExit.value;
        } else {
          const cause = Cause.squash(rowExit.cause);
          cleanupError = toWorkspaceE2EError(
            "read latest checkout cleanup row",
            cause
          );
          if (workflowError)
            log(
              `Dotypos fallback cleanup row lookup failed: ${redact(String(cause))}`
            );
        }
      }
      if (datasourceConfig && state.checkoutRow?.dotypos_reservation_id) {
        const dotyposReservationId = state.checkoutRow.dotypos_reservation_id;
        const cleanupExit = yield* Effect.exit(
          cancelDotyposReservation(datasourceConfig, dotyposReservationId)
        );
        if (Exit.isFailure(cleanupExit)) {
          const cause = Cause.squash(cleanupExit.cause);
          cleanupError = toWorkspaceE2EError(
            "cancel Dotypos checkout reservation",
            cause
          );
          if (workflowError)
            log(`Dotypos cleanup failed: ${redact(String(cause))}`);
        }
      }
    }

    return cleanupError;
  });

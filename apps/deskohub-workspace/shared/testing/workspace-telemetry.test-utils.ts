import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  type WorkspaceTelemetryHandle,
  workspaceTelemetryHandle,
} from "@/shared/backend/observability/workspace-telemetry";

const setWorkspaceTelemetry = (handle: WorkspaceTelemetryHandle) => {
  Reflect.set(globalThis, workspaceTelemetryHandle, handle);
};

/**
 * Sends the process's Workspace logs to the SDK's in-memory exporter, in
 * place of PostHog, as each record is emitted. Call before the file's first
 * Workspace run: the runtime resolves the process logger provider once, when
 * it builds.
 */
export const captureWorkspaceLogs = () => {
  const exporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter })],
  });
  setWorkspaceTelemetry({ loggerProvider });

  return {
    loggerProvider,
    /** Every log record the process's Workspace runs have emitted. */
    records: () => exporter.getFinishedLogRecords(),
    reset: () => exporter.reset(),
  };
};

/**
 * Makes resolving the process's Workspace telemetry throw `failure`, as a
 * PostHog configuration the logger provider can't be built from does, so the
 * Workspace runtime can't build its observability. Call before the file's
 * first Workspace run.
 */
export const failWorkspaceTelemetry = (failure: Error) => {
  setWorkspaceTelemetry({
    get loggerProvider(): never {
      throw failure;
    },
  });
};

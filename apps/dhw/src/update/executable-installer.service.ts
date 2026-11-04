import {
  Context,
  Crypto,
  Data,
  Effect,
  Encoding,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stream,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import {
  type BuildTarget,
  DHW_BUILD_TARGET,
  type ReleaseBuildTarget,
} from "../build-info";
import type { AvailableUpdate } from "./update-state-store.service";

const CandidateBuildInfo = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.String,
    target: Schema.String,
  })
);

interface IExecutableInstaller {
  readonly install: (
    update: AvailableUpdate
  ) => Effect.Effect<void, ExecutableInstallerError>;
}

export class ExecutableInstaller extends Context.Service<
  ExecutableInstaller,
  IExecutableInstaller
>()("ExecutableInstaller") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const childProcessSpawner = yield* ChildProcessSpawner;
      const fileSystem = yield* FileSystem.FileSystem;
      const httpClient = yield* HttpClient.HttpClient;
      const path = yield* Path.Path;

      return {
        install: Effect.fn("ExecutableInstaller.install")(
          (update: AvailableUpdate) =>
            installExecutable({
              update,
              executable: {
                path: process.execPath,
                target: DHW_BUILD_TARGET,
              },
              crypto,
              fileSystem,
              httpClient,
              path,
            }).pipe(
              Effect.provideService(ChildProcessSpawner, childProcessSpawner),
              Effect.scoped,
              Effect.mapError(ExecutableInstallerError.fromCause)
            )
        ),
      };
    })
  );
}

export class ExecutableInstallerError extends Data.TaggedError(
  "ExecutableInstallerError"
)<{
  readonly message: string;
  readonly cause: unknown;
}> {
  static fromCause = (cause: unknown) =>
    cause instanceof ExecutableInstallerError
      ? cause
      : new ExecutableInstallerError({
          message: "The CLI update could not be installed.",
          cause,
        });
}

/** The executable an update replaces, and the target it was built for. */
interface RunningExecutable {
  readonly path: string;
  readonly target: BuildTarget;
}

interface InstallExecutableInput {
  readonly update: AvailableUpdate;
  readonly executable: RunningExecutable;
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly httpClient: HttpClient.HttpClient;
  readonly path: Path.Path;
}

export const installExecutable = Effect.fn("installExecutable")(function* ({
  update,
  executable,
  crypto,
  fileSystem,
  httpClient,
  path,
}: InstallExecutableInput) {
  const executablePath = executable.path;
  const executableInfo = yield* fileSystem.stat(executablePath);

  if (executableInfo.type !== "File") {
    return yield* new ExecutableInstallerError({
      message: "The current CLI executable is not a regular file.",
      cause: executableInfo.type,
    });
  }

  const candidatePath = yield* fileSystem.makeTempFileScoped({
    directory: path.dirname(executablePath),
    prefix: ".dhw-update-",
  });
  const response = yield* httpClient.execute(
    HttpClientRequest.get(update.assetUrl)
  );
  yield* HttpClientResponse.filterStatusOk(response);
  yield* response.stream.pipe(Stream.run(fileSystem.sink(candidatePath)));

  const candidateBytes = yield* fileSystem.readFile(candidatePath);

  if (candidateBytes.byteLength !== update.assetSize) {
    return yield* new ExecutableInstallerError({
      message: "The downloaded CLI did not match its release size.",
      cause: "size-mismatch",
    });
  }

  const candidateDigest = yield* crypto.digest("SHA-256", candidateBytes);
  const expectedDigest = update.assetDigest.slice("sha256:".length);

  if (Encoding.encodeHex(candidateDigest).toLowerCase() !== expectedDigest) {
    return yield* new ExecutableInstallerError({
      message: "The downloaded CLI did not match its release digest.",
      cause: "digest-mismatch",
    });
  }

  yield* fileSystem.chmod(candidatePath, executableInfo.mode);
  yield* syncFile(fileSystem, candidatePath);
  yield* verifyCandidate(candidatePath, update, executable.target);
  yield* fileSystem.rename(candidatePath, executablePath);
});

const syncFile = (fileSystem: FileSystem.FileSystem, path: string) =>
  Effect.scoped(
    fileSystem
      .open(path, { flag: "r" })
      .pipe(Effect.flatMap((file) => file.sync))
  );

const verifyCandidate = Effect.fn("verifyUpdateCandidate")(function* (
  candidatePath: string,
  expected: { readonly version: string; readonly target: ReleaseBuildTarget },
  runningTarget: BuildTarget
) {
  const handle = yield* ChildProcess.make(candidatePath, ["version", "--json"]);
  const output = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (text, chunk) => text + chunk
    )
  );
  const exitCode = yield* handle.exitCode;
  const buildInfo = yield* Schema.decodeEffect(CandidateBuildInfo)(
    output.trim()
  );

  if (
    exitCode !== 0 ||
    buildInfo.version !== expected.version ||
    buildInfo.target !== expected.target ||
    buildInfo.target !== runningTarget
  ) {
    return yield* new ExecutableInstallerError({
      message: "The downloaded CLI reported unexpected build information.",
      cause: { exitCode, buildInfo },
    });
  }
});

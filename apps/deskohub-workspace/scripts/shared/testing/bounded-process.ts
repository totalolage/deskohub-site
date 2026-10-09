type BoundedProcessOptions = {
  readonly cmd: readonly string[];
  readonly cwd: string;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
};

type BoundedProcessResult =
  | {
      readonly exitCode: 0;
      readonly outcome: "success";
      readonly stdout: string;
    }
  | {
      readonly exitCode: number;
      readonly outcome: "failed";
    }
  | {
      readonly exitCode: number;
      readonly outcome: "output-limit";
    }
  | {
      readonly exitCode: number;
      readonly outcome: "timed-out";
    };

type CapturedStream = {
  readonly bytesRead: number;
  readonly text?: string;
};

const readStream = async (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  retainText: boolean,
  onLimit: () => void
): Promise<CapturedStream> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      const remainingBytes = Math.max(0, maxBytes - retainedBytes);
      const capturedChunk = value.subarray(0, remainingBytes);
      if (retainText && capturedChunk.byteLength > 0) {
        chunks.push(capturedChunk);
      }
      retainedBytes += capturedChunk.byteLength;

      if (value.byteLength > capturedChunk.byteLength) onLimit();
    }
  } finally {
    reader.releaseLock();
  }

  if (!retainText) return { bytesRead };

  const output = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytesRead, text: new TextDecoder().decode(output) };
};

export const runBoundedProcess = async ({
  cmd,
  cwd,
  maxOutputBytes,
  timeoutMs,
}: BoundedProcessOptions): Promise<BoundedProcessResult> => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("maxOutputBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive safe integer");
  }

  const child = Bun.spawn([...cmd], {
    cwd,
    killSignal: "SIGKILL",
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  let timedOut = false;
  let outputLimitExceeded = false;
  const terminate = () => {
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const onOutputLimit = () => {
    if (outputLimitExceeded) return;
    outputLimitExceeded = true;
    terminate();
  };
  const stdoutPromise = readStream(
    child.stdout,
    maxOutputBytes,
    true,
    onOutputLimit
  );
  const stderrPromise = readStream(
    child.stderr,
    maxOutputBytes,
    false,
    onOutputLimit
  );

  try {
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      stdoutPromise,
      stderrPromise,
    ]).then(([code, capturedStdout]) => [code, capturedStdout] as const);

    if (timedOut) return { exitCode, outcome: "timed-out" };
    if (outputLimitExceeded) return { exitCode, outcome: "output-limit" };
    if (exitCode !== 0) return { exitCode, outcome: "failed" };

    return {
      exitCode: 0,
      outcome: "success",
      stdout: stdout.text ?? "",
    };
  } catch (error) {
    terminate();
    await Promise.allSettled([child.exited, stdoutPromise, stderrPromise]);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

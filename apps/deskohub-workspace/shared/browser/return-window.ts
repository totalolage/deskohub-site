"use client";

const DEFAULT_RETURN_LISTENER_TTL_MS = 10 * 60 * 1000;
const DEFAULT_HANDOFF_TIMEOUT_MS = 1500;
const RETURN_LOCK_PREFIX = "deskohub:return-window:";
const RETURN_EVENT = "return";
const HANDLED_EVENT = "handled";
const RETURN_MESSAGE = { type: RETURN_EVENT } as const;
const HANDLED_MESSAGE = { handled: true, type: HANDLED_EVENT } as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Cleanup = () => void;

type CoordinateReturnWindowOptions = {
  readonly key: string;
  readonly onDuplicate: () => void;
  readonly owner: boolean;
};

type ReturnLockOptions = {
  readonly key: string;
  readonly lockOptions: LockOptions;
  readonly onAcquired?: () => void;
  readonly onCompleted?: () => void;
  readonly onDuplicate: () => void;
  readonly onError?: (cause: unknown) => void;
  readonly notifyAbortAsDuplicate: boolean;
  readonly holdLock: boolean;
};

type ListenForReturnOptions = {
  readonly attemptId: string;
  readonly onReturn: (signal: AbortSignal) => Promise<boolean>;
  readonly ttlMs?: number;
};

type HandOffReturnOptions = {
  readonly attemptId: string;
  readonly timeoutMs?: number;
};

const noop: Cleanup = () => undefined;

const getLockManager = (): LockManager | undefined => {
  try {
    const locks = globalThis.navigator?.locks;
    return locks || undefined;
  } catch {
    return undefined;
  }
};

const getBroadcastChannelConstructor = ():
  | typeof BroadcastChannel
  | undefined => {
  try {
    const broadcastChannel = globalThis.BroadcastChannel;
    return broadcastChannel || undefined;
  } catch {
    return undefined;
  }
};

const isAttemptId = (attemptId: string) => {
  try {
    return UUID_V4_PATTERN.test(attemptId);
  } catch {
    return false;
  }
};

const getAttemptLockKey = (attemptId: string) =>
  `${RETURN_LOCK_PREFIX}${attemptId}`;

const getAttemptChannelKey = (attemptId: string) => attemptId;

const getDelay = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value) || value < 0
    ? fallback
    : value;

const isAbortError = (cause: unknown) => {
  try {
    return cause instanceof DOMException && cause.name === "AbortError";
  } catch {
    return false;
  }
};

const startReturnLock = ({
  key,
  lockOptions,
  onAcquired,
  onCompleted,
  onDuplicate,
  onError,
  notifyAbortAsDuplicate,
  holdLock,
}: ReturnLockOptions): Cleanup => {
  const lockManager = getLockManager();
  if (!lockManager) return noop;

  let active = true;
  let duplicateNotified = false;
  let releaseLock: () => void = noop;
  const lockHold = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const notifyDuplicate = () => {
    if (!active || duplicateNotified) return;
    duplicateNotified = true;
    try {
      onDuplicate();
    } catch {
      // A duplicate callback must not leave the lock request rejected.
    }
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    releaseLock();
  };

  const handleError = (cause: unknown) => {
    if (!active) return;
    if (notifyAbortAsDuplicate && isAbortError(cause)) {
      notifyDuplicate();
      return;
    }
    try {
      onError?.(cause);
    } catch {
      // Browser API failures must not escape the coordination boundary.
    }
  };

  const handleLock = (lock: Lock | null) => {
    if (!active) return;
    if (!lock) {
      notifyDuplicate();
      return;
    }

    try {
      onAcquired?.();
    } catch (cause) {
      handleError(cause);
      return;
    }

    if (holdLock) return lockHold;
  };

  try {
    Promise.resolve(lockManager.request(key, lockOptions, handleLock))
      .then(() => {
        try {
          onCompleted?.();
        } catch (cause) {
          handleError(cause);
        }
      })
      .catch(handleError);
  } catch (cause) {
    handleError(cause);
  }

  return cleanup;
};

export const coordinateReturnWindow = ({
  key,
  onDuplicate,
  owner,
}: CoordinateReturnWindowOptions): Cleanup =>
  startReturnLock({
    key,
    lockOptions: owner
      ? { mode: "exclusive", steal: true }
      : { ifAvailable: true, mode: "exclusive" },
    onDuplicate,
    notifyAbortAsDuplicate: !owner,
    holdLock: true,
  });

export const listenForReturn = ({
  attemptId,
  onReturn,
  ttlMs,
}: ListenForReturnOptions): Cleanup => {
  if (!isAttemptId(attemptId)) return noop;

  const lockManager = getLockManager();
  const BroadcastChannelConstructor = getBroadcastChannelConstructor();
  if (!lockManager || !BroadcastChannelConstructor) return noop;

  let abortController: AbortController;
  try {
    abortController = new AbortController();
  } catch {
    return noop;
  }

  let active = true;
  let channel: BroadcastChannel | undefined;
  let removeMessageListener: Cleanup = noop;
  let stopLock: Cleanup = noop;
  let expiryTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let returnStarted = false;
  let acknowledgementSent = false;

  const dispose = () => {
    if (!active) return;
    active = false;
    try {
      abortController.abort();
    } catch {
      // Cleanup is best effort when a browser abort API throws.
    }
    if (expiryTimer !== undefined) {
      try {
        globalThis.clearTimeout(expiryTimer);
      } catch {
        // Cleanup is best effort when a browser timer API is unavailable.
      }
      expiryTimer = undefined;
    }
    removeMessageListener();
    removeMessageListener = noop;
    try {
      channel?.close();
    } catch {
      // Cleanup is best effort when a browser channel API throws.
    }
    channel = undefined;
    stopLock();
    stopLock = noop;
  };

  const handleMessage = (event: MessageEvent) => {
    if (
      !active ||
      returnStarted ||
      acknowledgementSent ||
      !isReturnMessage(event.data)
    ) {
      return;
    }
    returnStarted = true;

    Promise.resolve()
      .then(() => onReturn(abortController.signal))
      .then((handled) => {
        if (!active || acknowledgementSent || handled !== true || !channel) {
          return;
        }
        acknowledgementSent = true;
        try {
          channel.postMessage(HANDLED_MESSAGE);
        } catch {
          // A failed acknowledgement is indistinguishable from an unhandled return.
        }
      })
      .catch(() => {
        // A failed return handler is intentionally not acknowledged.
      });
  };

  const onAcquired = () => {
    if (!active) return;
    try {
      channel = new BroadcastChannelConstructor(
        getAttemptChannelKey(attemptId)
      );
      channel.addEventListener("message", handleMessage);
      removeMessageListener = () => {
        try {
          channel?.removeEventListener("message", handleMessage);
        } catch {
          // Cleanup is best effort when a browser channel API throws.
        }
      };
    } catch {
      dispose();
    }
  };

  try {
    expiryTimer = globalThis.setTimeout(
      dispose,
      getDelay(ttlMs, DEFAULT_RETURN_LISTENER_TTL_MS)
    );
  } catch {
    dispose();
    return noop;
  }

  stopLock = startReturnLock({
    key: getAttemptLockKey(attemptId),
    lockOptions: { mode: "exclusive" },
    onAcquired,
    onDuplicate: dispose,
    onError: dispose,
    notifyAbortAsDuplicate: false,
    holdLock: true,
  });
  if (!active) stopLock();

  return dispose;
};

export const handOffReturn = ({
  attemptId,
  timeoutMs,
}: HandOffReturnOptions): Promise<boolean> => {
  if (!isAttemptId(attemptId)) return Promise.resolve(false);

  const lockManager = getLockManager();
  const BroadcastChannelConstructor = getBroadcastChannelConstructor();
  if (!lockManager || !BroadcastChannelConstructor)
    return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let active = true;
    let channel: BroadcastChannel | undefined;
    let removeMessageListener: Cleanup = noop;
    let stopLock: Cleanup = noop;
    let timeoutTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let noOwner = false;
    let returnSent = false;

    const settle = (handled: boolean) => {
      if (!active) return;
      active = false;
      if (timeoutTimer !== undefined) {
        try {
          globalThis.clearTimeout(timeoutTimer);
        } catch {
          // Cleanup is best effort when a browser timer API is unavailable.
        }
        timeoutTimer = undefined;
      }
      removeMessageListener();
      removeMessageListener = noop;
      try {
        channel?.close();
      } catch {
        // Cleanup is best effort when a browser channel API throws.
      }
      channel = undefined;
      stopLock();
      stopLock = noop;
      resolve(handled);
    };

    const handleMessage = (event: MessageEvent) => {
      if (!active || !isHandledMessage(event.data)) return;
      settle(true);
    };

    const sendReturn = () => {
      if (!active || returnSent || !channel) return;
      returnSent = true;
      try {
        channel.postMessage(RETURN_MESSAGE);
      } catch {
        settle(false);
        return;
      }
    };

    try {
      timeoutTimer = globalThis.setTimeout(
        () => settle(false),
        getDelay(timeoutMs, DEFAULT_HANDOFF_TIMEOUT_MS)
      );
    } catch {
      settle(false);
      return;
    }
    if (!active) return;

    try {
      channel = new BroadcastChannelConstructor(
        getAttemptChannelKey(attemptId)
      );
      channel.addEventListener("message", handleMessage);
      removeMessageListener = () => {
        try {
          channel?.removeEventListener("message", handleMessage);
        } catch {
          // Cleanup is best effort when a browser channel API throws.
        }
      };
    } catch {
      settle(false);
      return;
    }

    stopLock = startReturnLock({
      key: getAttemptLockKey(attemptId),
      lockOptions: { ifAvailable: true, mode: "exclusive" },
      onAcquired: () => {
        noOwner = true;
      },
      onCompleted: () => {
        if (noOwner) settle(false);
      },
      onDuplicate: sendReturn,
      onError: () => settle(false),
      notifyAbortAsDuplicate: false,
      holdLock: false,
    });
    if (!active) stopLock();
  });
};

const isReturnMessage = (
  value: MessageEvent["data"]
): value is typeof RETURN_MESSAGE => {
  try {
    return value !== null && value !== undefined && value.type === RETURN_EVENT;
  } catch {
    return false;
  }
};

const isHandledMessage = (
  value: MessageEvent["data"]
): value is typeof HANDLED_MESSAGE => {
  try {
    return (
      value !== null &&
      value !== undefined &&
      value.type === HANDLED_EVENT &&
      value.handled === true
    );
  } catch {
    return false;
  }
};

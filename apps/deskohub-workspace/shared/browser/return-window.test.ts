import { afterEach, describe, expect, jest, mock, test } from "bun:test";

const VALID_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440001";

type MessageListener = (event: MessageEvent) => void;

class TestBroadcastChannel {
  static readonly channels = new Map<string, Set<TestBroadcastChannel>>();
  static readonly postedMessages: Array<{
    readonly data: MessageEvent["data"];
    readonly name: string;
  }> = [];

  readonly name: string;
  private readonly listeners = new Set<MessageListener>();
  private closed = false;

  constructor(name: string) {
    this.name = name;
    const channels =
      TestBroadcastChannel.channels.get(name) ??
      new Set<TestBroadcastChannel>();
    channels.add(this);
    TestBroadcastChannel.channels.set(name, channels);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "message") return;
    this.listeners.add(listener as MessageListener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ) {
    if (type !== "message") return;
    this.listeners.delete(listener as MessageListener);
  }

  postMessage(data: MessageEvent["data"]) {
    if (this.closed)
      throw new DOMException("Channel is closed", "InvalidStateError");
    TestBroadcastChannel.postedMessages.push({ data, name: this.name });
    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this || channel.closed) continue;
      for (const listener of channel.listeners) {
        queueMicrotask(() => listener(new MessageEvent("message", { data })));
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset() {
    TestBroadcastChannel.channels.clear();
    TestBroadcastChannel.postedMessages.length = 0;
  }
}

type TestLock = Lock;

class TestLockManager {
  readonly requests = mock(
    (
      name: string,
      options: LockOptions,
      callback: (lock: TestLock | null) => Promise<unknown> | unknown
    ) => {
      if (options.ifAvailable && this.held.has(name)) {
        return Promise.resolve().then(() => callback(null));
      }

      if (this.held.has(name)) {
        return Promise.reject(new DOMException("Lock is held", "AbortError"));
      }

      this.held.add(name);
      return Promise.resolve()
        .then(() =>
          callback({
            name,
            mode: "exclusive",
          } as TestLock)
        )
        .finally(() => this.held.delete(name));
    }
  );
  private readonly held = new Set<string>();

  get request() {
    return this.requests;
  }

  reset() {
    this.held.clear();
    this.requests.mockClear();
  }
}

const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
  globalThis,
  "BroadcastChannel"
);
const originalAbortController = Object.getOwnPropertyDescriptor(
  globalThis,
  "AbortController"
);
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
const lockManager = new TestLockManager();

function installBrowserApis() {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: TestBroadcastChannel,
  });
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: lockManager,
  });
}

function restoreBrowserApis() {
  if (originalBroadcastChannel) {
    Object.defineProperty(
      globalThis,
      "BroadcastChannel",
      originalBroadcastChannel
    );
  } else {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
  if (originalLocks) {
    Object.defineProperty(navigator, "locks", originalLocks);
  } else {
    Reflect.deleteProperty(navigator, "locks");
  }
  if (originalAbortController) {
    Object.defineProperty(
      globalThis,
      "AbortController",
      originalAbortController
    );
  } else {
    Reflect.deleteProperty(globalThis, "AbortController");
  }
}

async function flushMessages() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("return-window coordination", () => {
  afterEach(() => {
    jest.useRealTimers();
    lockManager.reset();
    TestBroadcastChannel.reset();
    restoreBrowserApis();
  });

  test("returns false when the attempt has no live owner", async () => {
    installBrowserApis();

    const { handOffReturn } = await import("./return-window");

    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 10 })
    ).toBe(false);
  });

  test("bounds a pending lock request and ignores its late callback", async () => {
    installBrowserApis();
    let lateCallback:
      | ((lock: TestLock | null) => Promise<unknown> | unknown)
      | undefined;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: mock(
          (
            _name: string,
            _options: LockOptions,
            callback: (lock: TestLock | null) => Promise<unknown> | unknown
          ) => {
            lateCallback = callback;
            return new Promise<never>(() => undefined);
          }
        ),
      },
    });
    const { handOffReturn } = await import("./return-window");

    const handoff = handOffReturn({
      attemptId: VALID_ATTEMPT_ID,
      timeoutMs: 5,
    });
    expect(await handoff).toBe(false);
    lateCallback?.(null);
    expect(TestBroadcastChannel.postedMessages).toEqual([]);
  });

  test("acknowledges only after an asynchronous handler completes", async () => {
    installBrowserApis();
    let completeHandler!: (handled: boolean) => void;
    const onReturn = mock(
      () =>
        new Promise<boolean>((resolve) => {
          completeHandler = resolve;
        })
    );
    const { handOffReturn, listenForReturn } = await import("./return-window");
    const stopListening = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn,
      ttlMs: 100,
    });

    const handoff = handOffReturn({
      attemptId: VALID_ATTEMPT_ID,
      timeoutMs: 50,
    });
    await flushMessages();
    expect(onReturn).toHaveBeenCalledTimes(1);

    let resolved = false;
    void handoff.then(() => {
      resolved = true;
    });
    await flushMessages();
    expect(resolved).toBe(false);

    completeHandler(true);
    expect(await handoff).toBe(true);
    stopListening();
  });

  test("does not acknowledge a false or throwing handler", async () => {
    installBrowserApis();
    const { handOffReturn, listenForReturn } = await import("./return-window");

    const stopFalse = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: async () => false,
      ttlMs: 100,
    });
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 5 })
    ).toBe(false);
    stopFalse();

    const stopThrow = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: async () => {
        throw new Error("synthetic handler failure");
      },
      ttlMs: 100,
    });
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 5 })
    ).toBe(false);
    stopThrow();
  });

  test("never acknowledges an expired or disposed listener", async () => {
    installBrowserApis();
    const { handOffReturn, listenForReturn } = await import("./return-window");

    const expiredHandler = mock(async () => true);
    const stopExpired = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: expiredHandler,
      ttlMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 5 })
    ).toBe(false);
    expect(expiredHandler).not.toHaveBeenCalled();
    stopExpired();

    let completeHandler!: (handled: boolean) => void;
    const pendingHandler = mock(
      () =>
        new Promise<boolean>((resolve) => {
          completeHandler = resolve;
        })
    );
    const stopDisposed = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: pendingHandler,
      ttlMs: 100,
    });
    const handoff = handOffReturn({
      attemptId: VALID_ATTEMPT_ID,
      timeoutMs: 20,
    });
    await flushMessages();
    stopDisposed();
    completeHandler(true);
    expect(await handoff).toBe(false);
  });

  test("passes an abort signal and aborts an in-flight handler on cleanup", async () => {
    installBrowserApis();
    let receivedSignal!: AbortSignal;
    let completeHandler!: (handled: boolean) => void;
    const onReturn = mock(
      (signal: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          receivedSignal = signal;
          completeHandler = resolve;
        })
    );
    const { handOffReturn, listenForReturn } = await import("./return-window");
    const stopListening = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn,
      ttlMs: 100,
    });
    const handoff = handOffReturn({
      attemptId: VALID_ATTEMPT_ID,
      timeoutMs: 20,
    });
    await flushMessages();
    expect(receivedSignal.aborted).toBe(false);

    stopListening();
    expect(receivedSignal.aborted).toBe(true);
    completeHandler(true);
    expect(await handoff).toBe(false);
  });

  test("aborts an in-flight handler when the listener TTL expires", async () => {
    installBrowserApis();
    let receivedSignal!: AbortSignal;
    let completeHandler!: (handled: boolean) => void;
    const onReturn = mock(
      (signal: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          receivedSignal = signal;
          completeHandler = resolve;
        })
    );
    const { listenForReturn } = await import("./return-window");
    const stopListening = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn,
      ttlMs: 10,
    });
    await flushMessages();

    const sender = new TestBroadcastChannel(VALID_ATTEMPT_ID);
    sender.postMessage({ type: "return" });
    await flushMessages();
    expect(receivedSignal.aborted).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(receivedSignal.aborted).toBe(true);
    completeHandler(true);
    stopListening();
    sender.close();
  });

  test("aborts the listener controller when lock setup fails", async () => {
    installBrowserApis();
    let controller: AbortController | undefined;
    const NativeAbortController = globalThis.AbortController;
    class CapturingAbortController extends NativeAbortController {
      constructor() {
        super();
        controller = this;
      }
    }
    Object.defineProperty(globalThis, "AbortController", {
      configurable: true,
      value: CapturingAbortController,
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: () => {
          throw new DOMException("Synthetic lock failure", "InvalidStateError");
        },
      },
    });
    const { listenForReturn } = await import("./return-window");

    listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: async () => true,
      ttlMs: 100,
    });
    expect(controller?.signal.aborted).toBe(true);
  });

  test("handles duplicate return events only once", async () => {
    installBrowserApis();
    let completeHandler!: (handled: boolean) => void;
    const onReturn = mock(
      () =>
        new Promise<boolean>((resolve) => {
          completeHandler = resolve;
        })
    );
    const { listenForReturn } = await import("./return-window");
    const stopListening = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn,
      ttlMs: 100,
    });
    await flushMessages();

    const sender = new TestBroadcastChannel(VALID_ATTEMPT_ID);
    sender.postMessage({ type: "return" });
    sender.postMessage({ type: "return" });
    await flushMessages();
    expect(onReturn).toHaveBeenCalledTimes(1);

    stopListening();
    completeHandler(true);
    sender.close();
  });

  test("cleans up an attempt lock for a strict-mode-style remount", async () => {
    installBrowserApis();
    const { handOffReturn, listenForReturn } = await import("./return-window");
    const stopFirst = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: async () => true,
      ttlMs: 100,
    });
    await flushMessages();
    stopFirst();
    await flushMessages();

    const stopSecond = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: async () => true,
      ttlMs: 100,
    });
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 20 })
    ).toBe(true);
    stopSecond();
  });

  test("fails closed when either browser coordination API is unavailable", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: undefined,
    });
    const { handOffReturn, listenForReturn } = await import("./return-window");

    expect(
      listenForReturn({
        attemptId: VALID_ATTEMPT_ID,
        onReturn: async () => true,
      })
    ).toEqual(expect.any(Function));
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 5 })
    ).toBe(false);
  });

  test("fails closed when browser APIs throw", async () => {
    installBrowserApis();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: () => {
          throw new DOMException("Synthetic lock failure", "InvalidStateError");
        },
      },
    });
    const { handOffReturn, listenForReturn } = await import("./return-window");

    expect(
      listenForReturn({
        attemptId: VALID_ATTEMPT_ID,
        onReturn: async () => true,
        ttlMs: 100,
      })
    ).toEqual(expect.any(Function));
    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 5 })
    ).toBe(false);
  });

  test("isolates malformed and distinct attempts", async () => {
    installBrowserApis();
    const { handOffReturn, listenForReturn } = await import("./return-window");
    const malformedHandler = mock(async () => true);

    expect(
      listenForReturn({
        attemptId: "not-a-uuid",
        onReturn: malformedHandler,
      })
    ).toEqual(expect.any(Function));
    expect(await handOffReturn({ attemptId: "not-a-uuid", timeoutMs: 5 })).toBe(
      false
    );
    expect(malformedHandler).not.toHaveBeenCalled();
    expect(lockManager.request).not.toHaveBeenCalled();

    const firstHandler = mock(async () => true);
    const secondHandler = mock(async () => true);
    const stopFirst = listenForReturn({
      attemptId: VALID_ATTEMPT_ID,
      onReturn: firstHandler,
      ttlMs: 100,
    });
    const stopSecond = listenForReturn({
      attemptId: OTHER_ATTEMPT_ID,
      onReturn: secondHandler,
      ttlMs: 100,
    });

    expect(
      await handOffReturn({ attemptId: VALID_ATTEMPT_ID, timeoutMs: 20 })
    ).toBe(true);
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();
    stopFirst();
    stopSecond();
  });
});

const unavailableMessage =
  "Unavailable in component renderer: backend action was not executed.";

type AccountVisualActionTracker = {
  readonly invocationCount: number;
  readonly recordInvocation: () => void;
};

const globalScope = globalThis as typeof globalThis & {
  readonly __accountVisualActionTracker?: AccountVisualActionTracker;
};

const actionTracker =
  globalScope.__accountVisualActionTracker ??
  (() => {
    let invocationCount = 0;
    const tracker = {
      get invocationCount() {
        return invocationCount;
      },
      recordInvocation() {
        invocationCount += 1;
      },
    } as const satisfies AccountVisualActionTracker;
    Object.defineProperty(globalThis, "__accountVisualActionTracker", {
      configurable: false,
      enumerable: false,
      value: tracker,
      writable: false,
    });
    return tracker;
  })();

type UnavailableActionResult = {
  readonly data?: undefined;
  readonly serverError: string;
};

const unavailable = async (): Promise<UnavailableActionResult> => {
  actionTracker.recordInvocation();
  return { serverError: unavailableMessage };
};

export const completeCustomerProfile = unavailable;
export const updateCustomerProfile = unavailable;
export const deleteCustomerAccount = unavailable;

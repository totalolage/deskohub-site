import type * as Playwright from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import { captureAccountReview } from "./review-screenshots";

const accountPath = "/en-US/account";
const callbackPath = "/en-US/auth/callback";
const callbackLoadingName = "Loading sign-in…";
const callbackLoadingSelector =
  '[data-slot="auth-callback-loading"][role="status"][aria-busy="true"]';
const callbackHandoffFailureMessage =
  "Account callback handoff verification failed";

type AccountRouteHandler = Parameters<Playwright.Page["route"]>[1];

const callbackHandoffFailure = () => new Error(callbackHandoffFailureMessage);

const remainingBrowserActionBudget = (deadline: number): number => {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw callbackHandoffFailure();
  return remaining;
};

const throwIfCallbackHandoffAborted = (
  signal: AbortSignal | undefined
): void => {
  if (signal?.aborted) throw callbackHandoffFailure();
};

const waitForCallbackOperation = async <A>(
  operation: () => Promise<A>,
  deadline: number,
  signal?: AbortSignal
): Promise<A> => {
  throwIfCallbackHandoffAborted(signal);
  const timeout = remainingBrowserActionBudget(deadline);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(callbackHandoffFailure()), timeout);
  });
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        abort = () => reject(callbackHandoffFailure());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      })
    : undefined;
  const operationPromise = Promise.resolve().then(() => {
    throwIfCallbackHandoffAborted(signal);
    return operation();
  });
  const races: Promise<A>[] = [operationPromise, timeoutPromise];
  if (abortPromise) races.push(abortPromise);

  try {
    const result = await Promise.race(races);
    throwIfCallbackHandoffAborted(signal);
    remainingBrowserActionBudget(deadline);
    return result;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abort && signal) signal.removeEventListener("abort", abort);
  }
};

const isExactCallbackUrl = (page: Playwright.Page, baseOrigin: string) => {
  try {
    const url = new URL(page.url());
    return (
      url.origin === baseOrigin &&
      url.pathname === callbackPath &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

const isQualifyingAccountRequest = (request: Playwright.Request) => {
  const headers = request.headers();
  return (
    request.method() === "GET" &&
    headers.rsc === "1" &&
    headers["next-router-prefetch"] === undefined &&
    headers.purpose !== "prefetch"
  );
};

const waitForCallbackLoading = async (
  page: Playwright.Page,
  baseOrigin: string,
  deadline: number,
  signal: AbortSignal
): Promise<Playwright.ElementHandle<HTMLElement | SVGElement>> => {
  if (!isExactCallbackUrl(page, baseOrigin)) throw callbackHandoffFailure();

  const main = page.locator("main");
  const loadingCard = page.locator(callbackLoadingSelector);
  const loadingStatus = page.getByRole("status", {
    exact: true,
    name: callbackLoadingName,
  });
  const loadingText = loadingCard.getByText(callbackLoadingName, {
    exact: true,
  });
  const banner = page.getByRole("banner");
  const footer = page.getByRole("contentinfo");

  await waitForCallbackOperation(
    () =>
      loadingCard.waitFor({
        state: "visible",
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  if (
    (await waitForCallbackOperation(
      () => loadingCard.count(),
      deadline,
      signal
    )) !== 1
  )
    throw callbackHandoffFailure();
  await waitForCallbackOperation(
    () =>
      loadingStatus.waitFor({
        state: "visible",
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  await waitForCallbackOperation(
    () =>
      loadingText.waitFor({
        state: "visible",
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  await waitForCallbackOperation(
    () =>
      banner.waitFor({
        state: "visible",
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  await waitForCallbackOperation(
    () =>
      footer.waitFor({
        state: "visible",
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );

  const mainBox = await waitForCallbackOperation(
    () => main.boundingBox({ timeout: remainingBrowserActionBudget(deadline) }),
    deadline,
    signal
  );
  const cardBox = await waitForCallbackOperation(
    () =>
      loadingCard.boundingBox({
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  if (
    !mainBox ||
    mainBox.width <= 0 ||
    mainBox.height <= 0 ||
    !cardBox ||
    cardBox.width <= 0 ||
    cardBox.height <= 0
  ) {
    throw callbackHandoffFailure();
  }
  if (!isExactCallbackUrl(page, baseOrigin)) throw callbackHandoffFailure();

  const loadingElement = await waitForCallbackOperation(
    () =>
      loadingCard.elementHandle({
        timeout: remainingBrowserActionBudget(deadline),
      }),
    deadline,
    signal
  );
  if (!loadingElement) throw callbackHandoffFailure();
  return loadingElement;
};

const loadingElementIsVisible = async (
  loadingElement: Playwright.ElementHandle<HTMLElement | SVGElement>
): Promise<boolean> =>
  loadingElement.evaluate((element) => {
    if (!element.isConnected) return false;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      bounds.width > 0 &&
      bounds.height > 0
    );
  });

export const withCallbackHandoffReview = async (
  page: Playwright.Page,
  baseUrl: string,
  runCase: () => Promise<void>
): Promise<void> => {
  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    throw callbackHandoffFailure();
  }

  const accountRouteMatcher = (url: URL) =>
    url.origin === baseOrigin && url.pathname === accountPath;
  const abortController = new AbortController();
  let observedQualifyingRequest = false;
  let reviewFailed = false;
  let wrapperFailed = false;
  let runCaseFailed = false;
  let runCaseFailure: unknown;
  let routeCleanupOwed = false;
  let firstHandlerPromise: Promise<void> | undefined;
  let qualifyingRoute: Playwright.Route | undefined;
  let cleanupDeadline: number | undefined;
  let continuationPromise: Promise<void> | undefined;
  const handlerPromises: Promise<void>[] = [];

  const beginCleanup = () => {
    cleanupDeadline ??= Date.now() + workspaceE2ETimeouts.cleanupAction;
    return cleanupDeadline;
  };

  const continueImmediately = (route: Playwright.Route) => {
    const handlerPromise = waitForCallbackOperation(
      () => route.continue(),
      Date.now() + workspaceE2ETimeouts.cleanupAction
    ).catch(() => {
      reviewFailed = true;
    });
    return handlerPromise;
  };

  const continueQualifyingRoute = (route: Playwright.Route) => {
    continuationPromise ??= waitForCallbackOperation(
      () => route.continue(),
      cleanupDeadline ?? Date.now() + workspaceE2ETimeouts.cleanupAction
    ).catch(() => {
      reviewFailed = true;
    });
    return continuationPromise;
  };

  const handleAccountRoute: AccountRouteHandler = (route, request) => {
    let isQualifying = false;
    try {
      isQualifying = isQualifyingAccountRequest(request);
    } catch {
      reviewFailed = true;
    }

    if (!isQualifying || observedQualifyingRequest) {
      const handlerPromise = continueImmediately(route);
      handlerPromises.push(handlerPromise);
      return handlerPromise;
    }

    observedQualifyingRequest = true;
    qualifyingRoute = route;
    const handlerPromise = (async () => {
      try {
        const deadline = Date.now() + workspaceE2ETimeouts.browserAction;
        const loadingElement = await waitForCallbackLoading(
          page,
          baseOrigin,
          deadline,
          abortController.signal
        );
        await captureAccountReview(page, baseUrl, "callback-loading-desktop", {
          deadline,
          signal: abortController.signal,
        });
        if (!isExactCallbackUrl(page, baseOrigin))
          throw callbackHandoffFailure();
        if (
          !(await waitForCallbackOperation(
            () => loadingElementIsVisible(loadingElement),
            deadline,
            abortController.signal
          ))
        )
          throw callbackHandoffFailure();
      } catch {
        reviewFailed = true;
      } finally {
        await continueQualifyingRoute(route);
      }
    })();
    firstHandlerPromise = handlerPromise;
    handlerPromises.push(handlerPromise);
    return handlerPromise;
  };

  try {
    routeCleanupOwed = true;
    await waitForCallbackOperation(
      () => page.route(accountRouteMatcher, handleAccountRoute),
      Date.now() + workspaceE2ETimeouts.browserAction
    );
    try {
      await runCase();
    } catch (cause) {
      runCaseFailed = true;
      runCaseFailure = cause;
    }
  } catch {
    wrapperFailed = true;
  } finally {
    const sharedCleanupDeadline = beginCleanup();
    abortController.abort();
    if (qualifyingRoute) continueQualifyingRoute(qualifyingRoute);
    if (routeCleanupOwed) {
      try {
        await waitForCallbackOperation(
          () => page.unroute(accountRouteMatcher, handleAccountRoute),
          sharedCleanupDeadline
        );
      } catch {
        wrapperFailed = true;
      }
    }
    for (const handlerPromise of handlerPromises) {
      try {
        await waitForCallbackOperation(
          () => handlerPromise,
          sharedCleanupDeadline
        );
      } catch {
        reviewFailed = true;
      }
    }
  }

  if (runCaseFailed) throw runCaseFailure;
  if (
    wrapperFailed ||
    reviewFailed ||
    !observedQualifyingRequest ||
    !firstHandlerPromise
  ) {
    throw callbackHandoffFailure();
  }
};

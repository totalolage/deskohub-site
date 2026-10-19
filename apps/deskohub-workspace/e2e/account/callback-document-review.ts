import { randomUUID } from "node:crypto";
import type * as Playwright from "@playwright/test";
import {
  getAuthCallbackPath,
  signInAttemptParam,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import { workspaceE2ETimeouts } from "../timeouts";
import { holdsVirtualAuthenticator } from "../virtual-authenticator";
import {
  type CallbackLanding,
  expectedCallbackReturnValue,
  isExactCallbackUrl,
  signedInCallbackCopy,
} from "./callback-url";

/**
 * Receipt-backed review of the callback handoff document.
 *
 * A held qualifying account document request blocks every Playwright page-DOM
 * protocol operation (evaluate, locators, page.screenshot), so the signed-in
 * callback document is validated through a passive beforeunload binding receipt and
 * captured through the CDP compositor while the request stays held. The
 * listener stays observational: it never navigates, mutates storage, or
 * touches provider/auth state.
 */

const callbackLoadingSelector = '[data-slot="auth-callback-loading"]';
const mainSelector = 'main, [role="main"]';
const bannerSelector = '[role="banner"], body > header';
const footerSelector = '[role="contentinfo"], body > footer';

/** Metadata viewport of the desktop account review captures. */
export const callbackDocumentReviewViewport = {
  width: 1440,
  height: 1000,
} as const;

const callbackDocumentReviewFailureMessage =
  "Callback document review verification failed";

const callbackDocumentReviewFailure = () =>
  new Error(callbackDocumentReviewFailureMessage);

export type CallbackDocumentReview = {
  /**
   * Consume the one-shot valid receipt and capture the held document through
   * the CDP compositor. Fails closed on missing, stale, invalid, or already
   * consumed receipts and on any screenshot error, rechecking the receipt and
   * its owning main context after the capture settles.
   */
  capture: (options: {
    deadline: number;
    signal?: AbortSignal;
  }) => Promise<Buffer>;
  /**
   * Re-check the valid receipt against the current page URL using the strict
   * callback grammar. Remains valid after a capture while the same document
   * and main context persist. Never touches page DOM APIs after navigation.
   */
  validate: () => void;
  /**
   * Idempotently remove the binding and listeners, detach the CDP session,
   * and restore the viewport. Every step is attempted despite earlier
   * failures.
   */
  dispose: () => Promise<void>;
};

type BoundedOptions = {
  readonly deadline: number;
  readonly signal?: AbortSignal;
};

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw callbackDocumentReviewFailure();
};

/**
 * Scoped budget guard: races the operation against the deadline timer and the
 * abort signal, removes both listeners in `finally`, rechecks abort and
 * deadline after settling, and consumes the eventual rejection of the losing
 * operation so no late failure becomes an unhandled rejection.
 */
const runBounded = async <A>(
  operation: (timeout: number) => Promise<A>,
  deadline: number,
  signal?: AbortSignal
): Promise<A> => {
  throwIfAborted(signal);
  const timeout = deadline - Date.now();
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw callbackDocumentReviewFailure();
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const operationPromise = (async () => {
    throwIfAborted(signal);
    return operation(timeout);
  })();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(callbackDocumentReviewFailure()),
      timeout
    );
  });
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(callbackDocumentReviewFailure());
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;
  try {
    const result = await Promise.race(
      abortPromise
        ? [operationPromise, timeoutPromise, abortPromise]
        : [operationPromise, timeoutPromise]
    );
    throwIfAborted(signal);
    if (Date.now() > deadline) throw callbackDocumentReviewFailure();
    return result;
  } catch (cause) {
    // The losing operation may still reject later; consume that rejection.
    operationPromise.catch(() => undefined);
    throw cause instanceof Error &&
      cause.message === callbackDocumentReviewFailureMessage
      ? cause
      : callbackDocumentReviewFailure();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
};

/**
 * Pure beforeunload snapshot collector. Serialized into the page through
 * `addInitScript` (Playwright does not execute CDP-registered new-document
 * scripts), so it must reference no module scope. Returns a sanitized
 * payload: strictly boolean validity plus numeric metrics, never raw URL,
 * DOM markup, or identity values.
 */
export const collectCallbackDocumentSnapshot = (config: {
  readonly baseOrigin: string;
  readonly attemptParamName: string;
  readonly uuidPatternSource: string;
  readonly callbackPath: string;
  readonly returnParamName: string;
  /** The exact `return` value the URL carries, or null when it carries none. */
  readonly returnValue: string | null;
  readonly loadingSelector: string;
  readonly loadingAriaLabel: string;
  readonly titleText: string;
  readonly bodyText: string;
  readonly mainSelector: string;
  readonly bannerSelector: string;
  readonly footerSelector: string;
  readonly mainRole: string;
  readonly bannerRole: string;
  readonly footerRole: string;
  /** The capture viewport, or null when the review captures no pixels. */
  readonly viewport: { readonly width: number; readonly height: number } | null;
}): string => {
  // Strict callback grammar mirror of e2e/account/callback-url.ts: exact
  // origin and path, no fragment, at most one canonical UUIDv4 attempt param,
  // and exactly the expected return value when one is expected (none
  // otherwise).
  const urlGrammarValid = (rawUrl: string): boolean => {
    try {
      const url = new URL(rawUrl);
      if (
        url.origin !== config.baseOrigin ||
        url.pathname !== config.callbackPath
      ) {
        return false;
      }
      if (url.hash !== "") return false;
      const entries = [...url.searchParams.entries()];
      const attempts = entries.filter(
        ([name]) => name === config.attemptParamName
      );
      const returns = entries.filter(
        ([name]) => name === config.returnParamName
      );
      if (attempts.length + returns.length !== entries.length) return false;
      if (attempts.length > 1) return false;
      if (
        attempts[0] !== undefined &&
        !new RegExp(config.uuidPatternSource).test(attempts[0][1])
      ) {
        return false;
      }
      if (config.returnValue === null) return returns.length === 0;
      return returns.length === 1 && returns[0]?.[1] === config.returnValue;
    } catch {
      return false;
    }
  };

  const metrics: Record<string, number> = {};
  let valid = true;
  const fail = (metric: string) => {
    valid = false;
    metrics[metric] = 1;
  };

  const hiddenByAriaAncestor = (node: Element): boolean => {
    for (
      let current: Element | null = node;
      current;
      current = current.parentElement
    ) {
      if (current.getAttribute("aria-hidden") === "true") return true;
    }
    return false;
  };

  const isRendered = (node: Element): boolean => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  // The one visible element of a selector inside the card with the exact
  // trimmed text; each failure records only a numeric flag.
  const checkCardText = (
    card: Element,
    selector: string,
    text: string,
    metric: string
  ): void => {
    const nodes = card.querySelectorAll(selector);
    if (nodes.length !== 1) {
      fail(`${metric}Count`);
      return;
    }
    const node = nodes[0]!;
    if (node.textContent?.trim() !== text) fail(metric);
    if (hiddenByAriaAncestor(node) || !isRendered(node))
      fail(`${metric}Visible`);
  };

  // Conservative effective-default semantic role match: an explicit
  // role="none"/"presentation" override or an aria-hidden="true" ancestor
  // disqualifies a landmark. Nested header/footer elements are not implicitly
  // banner/contentinfo — the selectors only accept the exact role or a direct
  // body child, and the surrounding inline visibility is checked.
  const semanticLandmark = (
    selector: string,
    expectedRole: string
  ): Element | null => {
    const candidates = Array.from(document.querySelectorAll(selector));
    return (
      candidates.find((node) => {
        // Effective role must be exact: an explicit role override has to
        // equal the expected landmark role (header with role="navigation" or
        // footer with role="button" rejects); implicit semantics are only
        // accepted when no role attribute is present.
        const role = node.getAttribute("role");
        if (role !== null && role !== expectedRole) return false;
        return !hiddenByAriaAncestor(node);
      }) ?? null
    );
  };

  const checkLandmark = (
    selector: string,
    metric: string,
    expectedRole: string
  ): void => {
    const node = semanticLandmark(selector, expectedRole);
    if (!node) {
      fail(metric);
      metrics[`${metric}W`] = 0;
      metrics[`${metric}H`] = 0;
      return;
    }
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      fail(metric);
    }
    metrics[`${metric}W`] = Math.max(0, Math.round(rect.width));
    metrics[`${metric}H`] = Math.max(0, Math.round(rect.height));
  };

  if (window.top !== window) fail("frame");
  if (!urlGrammarValid(location.href)) fail("url");

  const cards = document.querySelectorAll(config.loadingSelector);
  if (cards.length !== 1) {
    fail("cards");
  } else {
    const card = cards[0]!;
    if (card.getAttribute("role") !== "status") fail("role");
    if (card.getAttribute("aria-busy") !== "true") fail("busy");
    if (card.getAttribute("aria-label") !== config.loadingAriaLabel)
      fail("label");
    checkCardText(card, "h1", config.titleText, "title");
    checkCardText(card, "p", config.bodyText, "body");
    if (hiddenByAriaAncestor(card)) fail("cardHidden");
    const style = getComputedStyle(card);
    const cardRect = card.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      cardRect.width <= 0 ||
      cardRect.height <= 0
    ) {
      fail("cardVisible");
    }
    metrics.cardW = Math.max(0, Math.round(cardRect.width));
    metrics.cardH = Math.max(0, Math.round(cardRect.height));
  }

  checkLandmark(config.mainSelector, "main", config.mainRole);
  checkLandmark(config.bannerSelector, "banner", config.bannerRole);
  checkLandmark(config.footerSelector, "footer", config.footerRole);

  // Loaded fonts and the capture viewport only matter to captured pixels.
  if (config.viewport) {
    if (document.fonts && document.fonts.status !== "loaded") fail("fonts");
    if (window.innerWidth !== config.viewport.width) fail("viewportW");
    if (window.innerHeight !== config.viewport.height) fail("viewportH");
  }

  return JSON.stringify(valid ? { v: true } : { v: false, m: metrics });
};

const isPayloadValidTrue = (payload: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(payload);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as Record<string, unknown>).length === 1 &&
      (parsed as Record<string, unknown>).v === true
    );
  } catch {
    return false;
  }
};

/**
 * The receipt requires the signed-in card of `landing`: its localized
 * callback path and exact return value, status label, heading, and body.
 * A null capture viewport prepares the handoff validation alone: the page
 * viewport is left untouched, the receipt skips the pixel-only font and
 * viewport checks, and `capture` fails closed.
 */
export const prepareCallbackDocumentReview = async (
  page: Playwright.Page,
  baseOrigin: string,
  landing: CallbackLanding,
  viewport: Playwright.ViewportSize | null,
  options: BoundedOptions
): Promise<CallbackDocumentReview> => {
  let baseOriginValid: string;
  try {
    baseOriginValid = new URL(baseOrigin).origin;
  } catch {
    throw callbackDocumentReviewFailure();
  }
  throwIfAborted(options.signal);
  const returnValue = expectedCallbackReturnValue(landing);
  if (
    returnValue === undefined ||
    !Number.isFinite(options.deadline) ||
    options.deadline <= Date.now() ||
    (viewport !== null && (viewport.width <= 0 || viewport.height <= 0))
  ) {
    throw callbackDocumentReviewFailure();
  }

  const cardCopy = signedInCallbackCopy(landing);
  const previousViewport = page.viewportSize();
  const bindingName = `__deskohubCallbackDocumentReview${randomUUID()}`;

  // Resource ledger: every acquisition marks what cleanup owes, so any
  // prepare failure (including timeouts and aborts) and any late-settling
  // acquisition still release everything that was actually taken. Release
  // flags make cleanup idempotent while still allowing a later cleanup pass
  // (a late-settling acquisition) to release new resources.
  let cdpSession: Playwright.CDPSession | undefined;
  let bindingAdded = false;
  let viewportOwed = false;
  let listenersRemoved = false;
  let bindingRemoved = false;
  let sessionDetached = false;
  let viewportRestored = false;
  // Removal closures are registered where the typed `on` call happens.
  const removeCdpListeners: Array<() => void> = [];

  // Receipt and consumption are tracked separately: the captured identity is
  // an immutable lifetime — captureConsumed, once true, never resets, and the
  // generation counter advances on every main document replacement, context
  // destruction, or cleared context so captured pixels can never be
  // rehabilitated by a later document.
  let receiptValid = false;
  let captureConsumed = false;
  let currentMainContextId: number | undefined;
  let documentGeneration = 0;
  let capturedContextId: number | undefined;
  let capturedGeneration: number | undefined;

  const invalidateReceipt = (): void => {
    receiptValid = false;
  };

  const cleanupDeadline = () => Date.now() + workspaceE2ETimeouts.cleanupAction;

  const cleanup = async (): Promise<void> => {
    let failed = false;
    if (cdpSession) {
      if (!listenersRemoved) {
        for (const removeListener of removeCdpListeners) removeListener();
        listenersRemoved = true;
      }
      if (bindingAdded && !bindingRemoved) {
        bindingRemoved = true;
        try {
          await runBounded(
            () =>
              cdpSession!.send("Runtime.removeBinding", { name: bindingName }),
            cleanupDeadline()
          );
        } catch {
          failed = true;
        }
      }
      // Detaching would also drop a passkey authenticator the lane added to
      // this page, so the session then ends with the page instead.
      if (!sessionDetached && !holdsVirtualAuthenticator(page)) {
        sessionDetached = true;
        try {
          await runBounded(() => cdpSession!.detach(), cleanupDeadline());
        } catch {
          failed = true;
        }
      }
    }
    if (viewportOwed && previousViewport && !viewportRestored) {
      viewportRestored = true;
      try {
        await runBounded(
          () => page.setViewportSize(previousViewport),
          cleanupDeadline()
        );
      } catch {
        failed = true;
      }
    }
    if (failed) throw callbackDocumentReviewFailure();
  };

  // Bounded acquisition with ownership separated from late cleanup: the
  // fulfillment continuation ALWAYS records resource ownership the moment
  // the acquisition fulfills, regardless of the bounded result, so a same
  // synchronous-turn fulfill+abort cannot make the caller's await skip the
  // assignment. When the bounded window failed, the continuation performs
  // the late release and full cleanup itself; exactly-once release is
  // guaranteed by the per-resource ledger flags, in both the
  // already-settled and later-settled cases.
  let cleanupRequested = false;
  const acquire = async <A>(
    start: () => Promise<A>,
    takeOwnership: (value: A) => void,
    lateRelease?: (value: A) => Promise<void>
  ): Promise<A> => {
    const original = start();
    void original.then(
      async (value) => {
        takeOwnership(value);
        if (!cleanupRequested) return;
        try {
          if (lateRelease) await lateRelease(value);
        } finally {
          await cleanup().catch(() => undefined);
        }
      },
      () => undefined
    );
    try {
      return await runBounded(() => original, options.deadline, options.signal);
    } catch (cause) {
      cleanupRequested = true;
      throw cause;
    }
  };

  try {
    if (viewport !== null) {
      const captureViewport = viewport;
      viewportOwed = true;
      await acquire(
        () => page.setViewportSize(captureViewport),
        () => {
          viewportOwed = true;
        },
        async () => {
          // The original viewport write settled after the bounded window
          // failed; a completed restoration must not permanently skip it, so
          // another restoration is owed unconditionally.
          viewportRestored = false;
        }
      );
    }

    cdpSession = await acquire(
      () => page.context().newCDPSession(page),
      (session) => {
        cdpSession = session;
      }
    );

    await acquire(
      () => cdpSession!.send("Runtime.enable"),
      () => undefined
    );

    // Inferred protocol type: { frameTree: { frame: { id: string } } }.
    const frameTree = await acquire(
      () => cdpSession!.send("Page.getFrameTree"),
      () => undefined
    );
    const mainFrameId = frameTree.frameTree.frame.id;

    await acquire(
      () => cdpSession!.send("Runtime.addBinding", { name: bindingName }),
      () => {
        // Ownership is recorded on fulfillment even on the late path, so
        // cleanup removes a binding that landed after its window failed.
        bindingAdded = true;
      }
    );

    const isMainDefaultContext = (description: {
      auxData?: { [key: string]: string };
    }): boolean => {
      // auxData is typed as a loose string index signature while the runtime
      // value of isDefault is boolean; narrow through unknown rather than
      // asserting a response shape.
      const auxData: unknown = description.auxData;
      const isDefault = (auxData as { isDefault?: unknown } | undefined)
        ?.isDefault;
      return description.auxData?.frameId === mainFrameId && isDefault === true;
    };

    const onExecutionContextCreated = (event: {
      context: {
        id: number;
        origin: string;
        auxData?: { [key: string]: string };
      };
    }): void => {
      if (!isMainDefaultContext(event.context)) return;
      // Any root main-default replacement — same URL included — first
      // invalidates all previous evidence and advances the generation.
      invalidateReceipt();
      documentGeneration += 1;
      // Only then may the id be admitted, and only when the context origin
      // exactly equals the normalized base origin; foreign and opaque
      // origins cannot provide a receipt.
      if (event.context.origin !== baseOriginValid) {
        currentMainContextId = undefined;
        return;
      }
      currentMainContextId = event.context.id;
    };

    const onExecutionContextDestroyed = (event: {
      executionContextId: number;
    }): void => {
      if (event.executionContextId !== currentMainContextId) return;
      currentMainContextId = undefined;
      invalidateReceipt();
      documentGeneration += 1;
    };

    const onExecutionContextsCleared = (): void => {
      currentMainContextId = undefined;
      invalidateReceipt();
      documentGeneration += 1;
    };

    const onBindingCalled = (event: {
      name: string;
      payload: string;
      executionContextId: number;
    }): void => {
      // Only the current main default context may deliver evidence; foreign,
      // subframe, or stale-context events are ignored so they can never
      // create or overwrite a valid receipt.
      if (event.name !== bindingName) return;
      if (event.executionContextId !== currentMainContextId) return;
      receiptValid = isPayloadValidTrue(event.payload);
    };

    cdpSession.on("Runtime.executionContextCreated", onExecutionContextCreated);
    cdpSession.on(
      "Runtime.executionContextDestroyed",
      onExecutionContextDestroyed
    );
    cdpSession.on(
      "Runtime.executionContextsCleared",
      onExecutionContextsCleared
    );
    cdpSession.on("Runtime.bindingCalled", onBindingCalled);
    removeCdpListeners.push(
      () =>
        cdpSession?.off(
          "Runtime.executionContextCreated",
          onExecutionContextCreated
        ),
      () =>
        cdpSession?.off(
          "Runtime.executionContextDestroyed",
          onExecutionContextDestroyed
        ),
      () =>
        cdpSession?.off(
          "Runtime.executionContextsCleared",
          onExecutionContextsCleared
        ),
      () => cdpSession?.off("Runtime.bindingCalled", onBindingCalled)
    );

    // Page-lifetime (Playwright cannot remove init scripts): the listener is
    // passive and turns fully inert once the binding is removed, because it
    // checks the binding before every use. Strictly observational.
    await acquire(
      () =>
        page.addInitScript(
          `
          (() => {
            const collect = ${collectCallbackDocumentSnapshot.toString()};
            const config = ${JSON.stringify({
              baseOrigin: baseOriginValid,
              attemptParamName: signInAttemptParam,
              uuidPatternSource:
                "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
              callbackPath: getAuthCallbackPath(landing.locale ?? "en-US"),
              returnParamName: signInCallbackReturnParam,
              returnValue,
              loadingSelector: callbackLoadingSelector,
              loadingAriaLabel: cardCopy.label,
              titleText: cardCopy.title,
              bodyText: cardCopy.body,
              mainSelector,
              bannerSelector,
              footerSelector,
              mainRole: "main",
              bannerRole: "banner",
              footerRole: "contentinfo",
              viewport,
            })};
            const binding = ${JSON.stringify(bindingName)};
            const report = () => {
              if (typeof globalThis[binding] !== "function") return;
              try {
                globalThis[binding](collect(config));
              } catch {
                // The document is leaving; a dropped receipt fails closed.
              }
            };
            window.addEventListener("beforeunload", report, { passive: true });
          })();
          `
        ),
      () => undefined
    );

    const requireCurrentValidReceipt = (): void => {
      if (!receiptValid || currentMainContextId === undefined) {
        throw callbackDocumentReviewFailure();
      }
      // Once a capture exists, its identity is immutable: validation only
      // passes while the exact captured generation and context persist, so a
      // replacement document — even with its own valid receipt — cannot
      // rehabilitate captured pixels.
      if (
        capturedGeneration !== undefined &&
        (documentGeneration !== capturedGeneration ||
          currentMainContextId !== capturedContextId)
      ) {
        throw callbackDocumentReviewFailure();
      }
    };

    return {
      capture: async (captureOptions: BoundedOptions): Promise<Buffer> => {
        throwIfAborted(captureOptions.signal);
        if (viewport === null || captureConsumed)
          throw callbackDocumentReviewFailure();
        requireCurrentValidReceipt();
        const contextAtStart = currentMainContextId;
        const generationAtStart = documentGeneration;
        capturedContextId = contextAtStart;
        capturedGeneration = generationAtStart;
        captureConsumed = true;
        const screenshot = await runBounded(
          () =>
            cdpSession!.send("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: true,
              fromSurface: true,
            }),
          captureOptions.deadline,
          captureOptions.signal
        );
        // The context or receipt may have been invalidated while the capture
        // was in flight; fail closed on any staleness against the exact
        // captured identity.
        if (
          !receiptValid ||
          currentMainContextId !== contextAtStart ||
          documentGeneration !== generationAtStart ||
          currentMainContextId === undefined
        ) {
          throw callbackDocumentReviewFailure();
        }
        const buffer = Buffer.from(screenshot.data, "base64");
        if (buffer.byteLength === 0) throw callbackDocumentReviewFailure();
        return buffer;
      },
      validate: (): void => {
        // Current receipt plus the strict URL grammar on the live page URL;
        // no page DOM APIs are used after navigation.
        requireCurrentValidReceipt();
        if (!isExactCallbackUrl(page, baseOrigin, landing)) {
          throw callbackDocumentReviewFailure();
        }
      },
      dispose: async (): Promise<void> => {
        await cleanup();
      },
    };
  } catch (cause) {
    await cleanup().catch(() => undefined);
    throw cause instanceof Error &&
      cause.message === callbackDocumentReviewFailureMessage
      ? cause
      : callbackDocumentReviewFailure();
  }
};

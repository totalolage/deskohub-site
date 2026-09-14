import { describe, expect, test } from "bun:test";
import type * as Playwright from "@playwright/test";
import {
  callbackDocumentReviewViewport,
  collectCallbackDocumentSnapshot,
  prepareCallbackDocumentReview,
} from "./callback-document-review";

const baseOrigin = "http://127.0.0.1:41017";
const validCallbackUrl = `${baseOrigin}/en-US/auth/callback?attempt=550e8400-e29b-41d4-a716-446655440000`;
const mainFrameId = "main-frame";
const mainContextId = 7;
const viewport = { ...callbackDocumentReviewViewport };

type CdpHandler = (params: unknown) => Promise<unknown> | unknown;

const makeFakeCdp = (overrides: {
  readonly screenshot?: CdpHandler;
  readonly removeBinding?: CdpHandler;
  readonly detach?: () => Promise<void>;
  readonly frameTree?: unknown;
  readonly failingMethods?: ReadonlySet<string>;
  readonly deferredMethods?: ReadonlyMap<string, (value: unknown) => void>;
}) => {
  const listeners = new Map<string, Set<(event: never) => void>>();
  const calls: string[] = [];
  const bindings = new Set<string>();
  const cdp = {
    on: (event: string, handler: (event: never) => void) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(handler));
    },
    off: (event: string, handler: (event: never) => void) => {
      listeners.get(event)?.delete(handler);
    },
    emit: (event: string, payload: unknown) => {
      for (const handler of listeners.get(event) ?? [])
        (handler as (p: unknown) => void)(payload);
    },
    send: async (method: string, params?: unknown): Promise<unknown> => {
      calls.push(method);
      if (overrides.failingMethods?.has(method))
        throw new Error(`protocol ${method} failed`);
      const deferred = overrides.deferredMethods?.get(method);
      if (deferred) {
        return new Promise((resolve) => {
          deferred(resolve);
        });
      }
      if (method === "Runtime.enable") return {};
      if (method === "Page.getFrameTree")
        return (
          overrides.frameTree ?? { frameTree: { frame: { id: mainFrameId } } }
        );
      if (method === "Runtime.addBinding") {
        bindings.add((params as { name: string }).name);
        return {};
      }
      if (method === "Runtime.removeBinding") {
        if (overrides.removeBinding) return overrides.removeBinding(params);
        return {};
      }
      if (method === "Page.captureScreenshot") {
        if (overrides.screenshot) return overrides.screenshot(params);
        return {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]).toString("base64"),
        };
      }
      return {};
    },
    detach: async () => {
      calls.push("detach");
      if (overrides.detach) return overrides.detach();
    },
  };
  return { cdp, listeners, calls, bindings };
};

type FakePageOverrides = {
  readonly cdp?: ReturnType<typeof makeFakeCdp>;
  readonly url?: string;
  readonly sessionDelayMs?: number;
  readonly setViewportDelayMs?: number;
};

const makeFakePage = (overrides: FakePageOverrides = {}) => {
  const viewports: Array<{ width: number; height: number }> = [
    { width: 800, height: 600 },
  ];
  const initScripts: string[] = [];
  const fakeCdp = overrides.cdp ?? makeFakeCdp({ failingMethods: new Set() });
  const page = {
    viewportSize: () => viewports[viewports.length - 1],
    setViewportSize: async (size: { width: number; height: number }) => {
      if (overrides.setViewportDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, overrides.setViewportDelayMs)
        );
      }
      viewports.push(size);
    },
    context: () => ({
      newCDPSession: async () => {
        if (overrides.sessionDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, overrides.sessionDelayMs)
          );
        }
        return fakeCdp.cdp;
      },
    }),
    addInitScript: async (source: string) => {
      initScripts.push(source);
    },
    url: () => overrides.url ?? validCallbackUrl,
  } as unknown as Playwright.Page;
  return { page, viewports, initScripts, fakeCdp };
};

type NodeOverrides = {
  readonly role?: string;
  readonly ariaHiddenAncestor?: boolean;
  readonly width?: number;
  readonly height?: number;
};

const makeLandmarkNode = (overrides: NodeOverrides = {}) => ({
  getAttribute: (name: string) => {
    if (name === "role") return overrides.role ?? null;
    if (name === "aria-hidden")
      return overrides.ariaHiddenAncestor ? "true" : null;
    return null;
  },
  getBoundingClientRect: () => ({
    width: overrides.width ?? 1264,
    height: overrides.height ?? 40,
    x: 8,
    y: 8,
  }),
  parentElement: null,
});

const makeSnapshotGlobals = (
  overrides: {
    readonly main?: NodeOverrides | null;
    readonly banner?: NodeOverrides | null;
    readonly footer?: NodeOverrides | null;
    readonly card?: Partial<{
      role: string | null;
      ariaBusy: string | null;
      ariaLabel: string | null;
      text: string;
      hidden: boolean;
      width: number;
      height: number;
      count: number;
    }>;
    readonly fontsStatus?: string;
    readonly locationHref?: string;
    readonly inner?: { width: number; height: number };
  } = {}
) => {
  const rect = (width: number, height: number) => ({
    width,
    height,
    x: 8,
    y: 8,
  });
  const card = {
    getAttribute: (name: string) => {
      if (name === "role") return overrides.card?.role ?? "status";
      if (name === "aria-busy") return overrides.card?.ariaBusy ?? "true";
      return overrides.card?.ariaLabel ?? "Loading sign-in…";
    },
    get textContent() {
      return overrides.card?.text ?? "  Loading sign-in…  ";
    },
    getBoundingClientRect: () =>
      rect(overrides.card?.width ?? 600, overrides.card?.height ?? 300),
    parentElement: overrides.card?.hidden
      ? {
          getAttribute: (name: string) =>
            name === "aria-hidden" ? "true" : null,
        }
      : null,
  };
  const cardCount = overrides.card?.count ?? 1;
  const supplierFor = (selector: string): (() => unknown[]) => {
    if (selector.includes("data-slot")) {
      return () => (cardCount === 1 ? [card] : []);
    }
    if (selector.includes("banner")) {
      return () =>
        overrides.banner === null ? [] : [makeLandmarkNode(overrides.banner)];
    }
    if (selector.includes("contentinfo")) {
      return () =>
        overrides.footer === null ? [] : [makeLandmarkNode(overrides.footer)];
    }
    return () =>
      overrides.main === null ? [] : [makeLandmarkNode(overrides.main)];
  };
  const fakeDocument = {
    querySelectorAll: (selector: string) => supplierFor(selector)(),
    querySelector: (selector: string) => supplierFor(selector)()[0] ?? null,
    fonts: { status: overrides.fontsStatus ?? "loaded" },
  };
  const inner = overrides.inner ?? { width: 1440, height: 1000 };
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    getComputedStyle: globalThis.getComputedStyle,
  };
  (globalThis as Record<string, unknown>).window = {
    innerWidth: inner.width,
    innerHeight: inner.height,
  };
  (globalThis.window as Record<string, unknown>).top =
    globalThis.window as unknown;
  (globalThis as Record<string, unknown>).document = fakeDocument;
  (globalThis as Record<string, unknown>).location = {
    href: overrides.locationHref ?? validCallbackUrl,
  };
  (globalThis as Record<string, unknown>).getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
  });
  return () => {
    (globalThis as Record<string, unknown>).window = previous.window;
    (globalThis as Record<string, unknown>).document = previous.document;
    (globalThis as Record<string, unknown>).location = previous.location;
    (globalThis as Record<string, unknown>).getComputedStyle =
      previous.getComputedStyle;
  };
};

const snapshotConfig = {
  baseOrigin,
  attemptParamName: "attempt",
  uuidPatternSource:
    "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  callbackPath: "/en-US/auth/callback",
  loadingSelector: '[data-slot="auth-callback-loading"]',
  loadingAriaLabel: "Loading sign-in…",
  mainSelector: 'main, [role="main"]',
  bannerSelector: '[role="banner"], body > header',
  footerSelector: '[role="contentinfo"], body > footer',
  mainRole: "main",
  bannerRole: "banner",
  footerRole: "contentinfo",
  viewport,
};

describe("collectCallbackDocumentSnapshot", () => {
  test("accepts a fully valid callback document", () => {
    const restore = makeSnapshotGlobals();
    try {
      expect(
        JSON.parse(collectCallbackDocumentSnapshot(snapshotConfig))
      ).toEqual({
        v: true,
      });
    } finally {
      restore();
    }
  });

  test("rejects invalid URL grammar families", () => {
    const families = [
      `${baseOrigin}/en-US/auth/callback?attempt=not-a-uuid`,
      `${baseOrigin}/en-US/auth/callback?attempt=550e8400-e29b-41d4-a716-446655440000&extra=1`,
      `${baseOrigin}/en-US/auth/callback?token=550e8400-e29b-41d4-a716-446655440000`,
      `${baseOrigin}/en-US/auth/callback#fragment`,
      `${baseOrigin}/en-US/account`,
      "https://foreign.example/en-US/auth/callback?attempt=550e8400-e29b-41d4-a716-446655440000",
    ];
    for (const href of families) {
      const restore = makeSnapshotGlobals({ locationHref: href });
      try {
        const parsed = JSON.parse(
          collectCallbackDocumentSnapshot(snapshotConfig)
        ) as { v: boolean };
        expect(parsed.v).toBe(false);
      } finally {
        restore();
      }
    }
  });

  test("rejects bad DOM snapshots independently", () => {
    const cases: Array<[string, Parameters<typeof makeSnapshotGlobals>[0]]> = [
      ["missing-loading-card", { card: { count: 0 } }],
      ["wrong-card-role", { card: { role: "none" } }],
      ["card-not-busy", { card: { ariaBusy: "false" } }],
      ["card-wrong-label", { card: { ariaLabel: "Other" } }],
      ["card-invisible", { card: { width: 0, height: 0 } }],
      ["card-aria-hidden-ancestor", { card: { hidden: true } }],
      ["main-missing", { main: null }],
      ["main-role-presentation", { main: { role: "presentation" } }],
      ["banner-role-none", { banner: { role: "none" } }],
      ["banner-aria-hidden-ancestor", { banner: { ariaHiddenAncestor: true } }],
      ["banner-missing", { banner: null }],
      ["banner-zero-bounds", { banner: { width: 0, height: 0 } }],
      ["footer-role-presentation", { footer: { role: "presentation" } }],
      ["footer-missing", { footer: null }],
      ["fonts-not-loaded", { fontsStatus: "loading" }],
    ];
    for (const [name, overrides] of cases) {
      const restore = makeSnapshotGlobals(overrides);
      try {
        const parsed = JSON.parse(
          collectCallbackDocumentSnapshot(snapshotConfig)
        ) as { v: boolean };
        expect(parsed.v).toBe(false);
      } finally {
        restore();
      }
    }
  });

  test("explicit role overrides must equal the expected landmark role exactly", () => {
    const rejects = [
      ["header-role-navigation", { banner: { role: "navigation" } }],
      ["footer-role-button", { footer: { role: "button" } }],
      ["main-role-navigation", { main: { role: "navigation" } }],
    ] as const;
    for (const [name, overrides] of rejects) {
      const restore = makeSnapshotGlobals(overrides);
      try {
        const parsed = JSON.parse(
          collectCallbackDocumentSnapshot(snapshotConfig)
        ) as { v: boolean };
        expect(parsed.v).toBe(false);
      } finally {
        restore();
      }
    }
    // Implicit semantics (no role attribute) and exact explicit roles accept.
    const accepts = [
      ["implicit-landmarks", {}],
      [
        "exact-explicit-roles",
        {
          main: { role: "main" },
          banner: { role: "banner" },
          footer: { role: "contentinfo" },
        },
      ],
    ] as const;
    for (const [name, overrides] of accepts) {
      const restore = makeSnapshotGlobals(overrides);
      try {
        const parsed = JSON.parse(
          collectCallbackDocumentSnapshot(snapshotConfig)
        ) as { v: boolean };
        expect(parsed.v).toBe(true);
      } finally {
        restore();
      }
    }
  });

  test("nested header and footer do not implicitly count as landmarks", () => {
    // The selectors only accept exact roles or direct body children, so a
    // page whose header/footer are nested renders no banner/contentinfo.
    const restore = makeSnapshotGlobals({
      banner: null,
      footer: null,
    });
    try {
      const parsed = JSON.parse(
        collectCallbackDocumentSnapshot(snapshotConfig)
      ) as { v: boolean };
      expect(parsed.v).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("prepareCallbackDocumentReview", () => {
  const receiptPayload = JSON.stringify({ v: true });

  const admitMainContext = (
    fakeCdp: ReturnType<typeof makeFakeCdp>,
    contextId = mainContextId,
    origin = baseOrigin
  ) => {
    fakeCdp.cdp.emit("Runtime.executionContextCreated", {
      context: {
        id: contextId,
        origin,
        auxData: { frameId: mainFrameId, isDefault: true },
      },
    });
  };

  const deliverReceipt = (
    fakeCdp: ReturnType<typeof makeFakeCdp>,
    overrides: {
      name?: string;
      payload?: string;
      executionContextId?: number;
    } = {}
  ) => {
    fakeCdp.cdp.emit("Runtime.bindingCalled", {
      name: overrides.name ?? [...fakeCdp.bindings][0],
      payload: overrides.payload ?? receiptPayload,
      executionContextId: overrides.executionContextId ?? mainContextId,
    });
  };

  const prepare = async (overrides: FakePageOverrides = {}) => {
    const fake = makeFakePage(overrides);
    const review = await prepareCallbackDocumentReview(
      fake.page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
      }
    );
    return { ...fake, review };
  };

  test("accepts a valid receipt on the current main default context, captures once, validates after, and cleans up", async () => {
    const { fakeCdp, viewports, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    review.validate();
    const buffer = await review.capture({ deadline: Date.now() + 10_000 });
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x89);
    // validate stays valid after capture while the same context persists.
    review.validate();
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
    await review.dispose();
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
    expect(fakeCdp.calls).toContain("Runtime.removeBinding");
    expect(fakeCdp.calls).toContain("detach");
  });

  test("ignores receipts from unexpected binding names and foreign or subframe contexts", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp, { name: "__unexpected" });
    expect(() => review.validate()).toThrow();
    // A valid receipt cannot be overwritten by a foreign context event.
    deliverReceipt(fakeCdp);
    deliverReceipt(fakeCdp, {
      payload: JSON.stringify({ v: false }),
      executionContextId: 99,
    });
    review.validate();
    // A foreign context cannot fabricate a receipt either.
    const { fakeCdp: fakeCdp2, review: review2 } = await prepare();
    admitMainContext(fakeCdp2);
    deliverReceipt(fakeCdp2, { executionContextId: 99 });
    expect(() => review2.validate()).toThrow();
  });

  test("rejects malformed and false payloads", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp, {
      payload: JSON.stringify({ v: false, m: { url: 1 } }),
    });
    expect(() => review.validate()).toThrow();
    const { fakeCdp: fakeCdp2, review: review2 } = await prepare();
    admitMainContext(fakeCdp2);
    deliverReceipt(fakeCdp2, { payload: "not-json" });
    expect(() => review2.validate()).toThrow();
  });

  test("a new main default context — same URL replacement included — clears the receipt", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    review.validate();
    admitMainContext(fakeCdp, mainContextId + 1);
    expect(() => review.validate()).toThrow();
  });

  test("main context destruction invalidates the receipt", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    review.validate();
    fakeCdp.cdp.emit("Runtime.executionContextDestroyed", {
      executionContextId: mainContextId,
    });
    expect(() => review.validate()).toThrow();
  });

  test("context destruction during capture fails closed after the screenshot settles", async () => {
    let releaseScreenshot: (value: unknown) => void = () => undefined;
    const fakeCdp = makeFakeCdp({
      failingMethods: new Set(),
      screenshot: () =>
        new Promise((resolve) => {
          releaseScreenshot = resolve;
        }),
    });
    const { review } = await prepare({ cdp: fakeCdp });
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    const capturePromise = review.capture({ deadline: Date.now() + 10_000 });
    fakeCdp.cdp.emit("Runtime.executionContextDestroyed", {
      executionContextId: mainContextId,
    });
    releaseScreenshot({ data: Buffer.from([0x89, 0x50]).toString("base64") });
    await expect(capturePromise).rejects.toThrow();
  });

  test("a pending document whose context never arrives yields no receipt", async () => {
    const { review } = await prepare();
    expect(() => review.validate()).toThrow();
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
  });

  test("honors deadline and abort signal", async () => {
    const { review } = await prepare();
    await expect(
      review.capture({ deadline: Date.now() - 1 })
    ).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    const { fakeCdp: fakeCdp2, review: review2 } = await prepare();
    admitMainContext(fakeCdp2);
    deliverReceipt(fakeCdp2);
    await expect(
      review2.capture({
        deadline: Date.now() + 10_000,
        signal: controller.signal,
      })
    ).rejects.toThrow();
  });

  test("fails closed on screenshot failure", async () => {
    const fakeCdp = makeFakeCdp({
      failingMethods: new Set(),
      screenshot: () => {
        throw new Error("compositor unavailable");
      },
    });
    const { review } = await prepare({ cdp: fakeCdp });
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
  });

  test("validates the live page URL strictly", async () => {
    const { fakeCdp, review } = await prepare({
      url: `${baseOrigin}/en-US/account`,
    });
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    expect(() => review.validate()).toThrow();
  });

  test("every partial acquisition failure cleans up and fails closed", async () => {
    const methods = [
      "Runtime.enable",
      "Page.getFrameTree",
      "Runtime.addBinding",
    ];
    for (const method of methods) {
      const fakeCdp = makeFakeCdp({ failingMethods: new Set([method]) });
      await expect(
        prepareCallbackDocumentReview(
          fakeCdp.page ?? makeFakePage({ cdp: fakeCdp }).page,
          baseOrigin,
          viewport,
          {
            deadline: Date.now() + 10_000,
          }
        )
      ).rejects.toThrow();
      expect(fakeCdp.calls).toContain("detach");
    }
  });

  test("a late CDP session resolution after prepare timeout does not leak", async () => {
    const fakeCdp = makeFakeCdp({ failingMethods: new Set() });
    const { page } = makeFakePage({ cdp: fakeCdp, sessionDelayMs: 300 });
    await expect(
      prepareCallbackDocumentReview(page, baseOrigin, viewport, {
        deadline: Date.now() + 50,
      })
    ).rejects.toThrow();
    expect(fakeCdp.calls).not.toContain("detach");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fakeCdp.calls).toContain("detach");
  });

  test("a midflight abort cleans up after the late viewport write settles", async () => {
    const controller = new AbortController();
    const fakeCdp = makeFakeCdp({ failingMethods: new Set() });
    const { page, viewports } = makeFakePage({
      cdp: fakeCdp,
      setViewportDelayMs: 300,
    });
    const preparePromise = prepareCallbackDocumentReview(
      page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
        signal: controller.signal,
      }
    );
    setTimeout(() => controller.abort(), 30);
    await expect(preparePromise).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 450));
    // The late viewport write settled; the continuation restored the original.
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
  });

  test("dispose is idempotent and attempts every step despite failures", async () => {
    const fakeCdp = makeFakeCdp({
      failingMethods: new Set(),
      removeBinding: () => {
        throw new Error("binding removal failed");
      },
    });
    const { page, viewports, review } = await prepare({ cdp: fakeCdp });
    await expect(review.dispose()).rejects.toThrow();
    expect(fakeCdp.calls).toContain("detach");
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
    // Idempotent: a second dispose neither throws nor repeats work.
    await review.dispose();
    const detachCalls = fakeCdp.calls.filter(
      (call) => call === "detach"
    ).length;
    expect(detachCalls).toBe(1);
    await review.dispose();
  });

  test("foreign or opaque main-default origins cannot admit a receipt, even with matching event ids", async () => {
    for (const origin of ["https://evil.example", "", ":"]) {
      const { fakeCdp, review } = await prepare();
      // Establish a valid receipt on the real origin first.
      admitMainContext(fakeCdp);
      deliverReceipt(fakeCdp);
      review.validate();
      // A replacement main default context with a foreign/opaque origin
      // invalidates the old evidence and is not admitted.
      admitMainContext(fakeCdp, mainContextId, origin);
      deliverReceipt(fakeCdp, { executionContextId: mainContextId });
      expect(() => review.validate()).toThrow();
    }
  });

  test("a same-URL replacement with its own valid receipt cannot rehabilitate captured pixels", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    const buffer = await review.capture({ deadline: Date.now() + 10_000 });
    expect(buffer.byteLength).toBeGreaterThan(0);
    // Replacement document B, same URL, valid B receipt — between capture
    // and persistence validate must fail against A's captured identity.
    admitMainContext(fakeCdp, mainContextId + 1);
    deliverReceipt(fakeCdp, { executionContextId: mainContextId + 1 });
    expect(() => review.validate()).toThrow();
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
  });

  test("replacement with a valid new receipt during capture fails the capture", async () => {
    let releaseScreenshot: (value: unknown) => void = () => undefined;
    const fakeCdp = makeFakeCdp({
      failingMethods: new Set(),
      screenshot: () =>
        new Promise((resolve) => {
          releaseScreenshot = resolve;
        }),
    });
    const { review } = await prepare({ cdp: fakeCdp });
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    const capturePromise = review.capture({ deadline: Date.now() + 10_000 });
    admitMainContext(fakeCdp, mainContextId + 1);
    deliverReceipt(fakeCdp, { executionContextId: mainContextId + 1 });
    releaseScreenshot({ data: Buffer.from([0x89, 0x50]).toString("base64") });
    await expect(capturePromise).rejects.toThrow();
  });

  test("captureConsumed is immutable: second capture rejects even after replacement invalidation", async () => {
    const { fakeCdp, review } = await prepare();
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    await review.capture({ deadline: Date.now() + 10_000 });
    admitMainContext(fakeCdp, mainContextId + 1);
    deliverReceipt(fakeCdp, { executionContextId: mainContextId + 1 });
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
  });

  test("late viewport write after a completed restore still owes a second restoration", async () => {
    const fakeCdp = makeFakeCdp({ failingMethods: new Set() });
    const viewports: Array<{ width: number; height: number }> = [
      { width: 800, height: 600 },
    ];
    let writes = 0;
    let releaseWrite: () => void = () => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const page = {
      viewportSize: () => viewports[viewports.length - 1],
      setViewportSize: async (size: { width: number; height: number }) => {
        writes += 1;
        if (writes === 1) await firstWrite;
        viewports.push(size);
      },
      context: () => ({ newCDPSession: async () => fakeCdp.cdp }),
      addInitScript: async () => {},
      url: () => validCallbackUrl,
    } as unknown as Playwright.Page;
    const controller = new AbortController();
    const preparePromise = prepareCallbackDocumentReview(
      page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
        signal: controller.signal,
      }
    );
    setTimeout(() => controller.abort(), 30);
    await expect(preparePromise).rejects.toThrow();
    // The abort-path cleanup performed one restoration while the original
    // write is still pending (the first entry is the previous viewport).
    expect(viewports).toEqual([
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    ]);
    const restorationsAfterCleanup = viewports.length - 1;
    expect(restorationsAfterCleanup).toBe(1);
    // The original write resolves late; the continuation owes and performs a
    // SECOND restoration, so the final viewport is the previous one.
    releaseWrite();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
    // Cleanup restoration, the late original write, then the owed SECOND
    // restoration — the final viewport is the previous one.
    expect(viewports).toEqual([
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      { width: 1440, height: 1000 },
      { width: 800, height: 600 },
    ]);
    expect(restorationsAfterCleanup).toBe(1);
  });

  test("session fulfilled and aborted in the same synchronous turn is owned and detached exactly once", async () => {
    const fakeCdp = makeFakeCdp({ failingMethods: new Set() });
    const viewports: Array<{ width: number; height: number }> = [
      { width: 800, height: 600 },
    ];
    let releaseSession: (session: unknown) => void = () => undefined;
    const page = {
      viewportSize: () => viewports[viewports.length - 1],
      setViewportSize: async (size: { width: number; height: number }) => {
        viewports.push(size);
      },
      context: () => ({
        newCDPSession: () =>
          new Promise((resolve) => {
            releaseSession = resolve;
          }),
      }),
      addInitScript: async () => {},
      url: () => validCallbackUrl,
    } as unknown as Playwright.Page;
    const controller = new AbortController();
    const preparePromise = prepareCallbackDocumentReview(
      page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
        signal: controller.signal,
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Same synchronous turn: fulfill the session, then abort — no
    // intervening await, so the caller's assignment can never happen.
    releaseSession(fakeCdp.cdp);
    controller.abort();
    await expect(preparePromise).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fakeCdp.calls.filter((call) => call === "detach")).toHaveLength(1);
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
  });

  test("binding fulfilled and aborted in the same synchronous turn is owned and removed exactly once", async () => {
    const releaseAddBinding: Array<(value: unknown) => void> = [];
    const fakeCdp = makeFakeCdp({
      failingMethods: new Set(),
      deferredMethods: new Map([
        [
          "Runtime.addBinding",
          (resolve: unknown) =>
            releaseAddBinding.push(resolve as (value: unknown) => void),
        ],
      ]),
    });
    const { page, viewports } = makeFakePage({ cdp: fakeCdp });
    const controller = new AbortController();
    const preparePromise = prepareCallbackDocumentReview(
      page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
        signal: controller.signal,
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseAddBinding[0]?.({});
    controller.abort();
    await expect(preparePromise).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fakeCdp.calls.filter((call) => call === "Runtime.removeBinding")
    ).toHaveLength(1);
    expect(fakeCdp.calls.filter((call) => call === "detach")).toHaveLength(1);
    expect(viewports[viewports.length - 1]).toEqual({
      width: 800,
      height: 600,
    });
  });

  test("viewport restore failure during dispose fails closed", async () => {
    const fakeCdp = makeFakeCdp({ failingMethods: new Set() });
    let setViewportCalls = 0;
    const viewports: Array<{ width: number; height: number }> = [
      { width: 800, height: 600 },
    ];
    const page = {
      viewportSize: () => viewports[viewports.length - 1],
      setViewportSize: async (size: { width: number; height: number }) => {
        setViewportCalls += 1;
        if (setViewportCalls > 1) throw new Error("viewport busy");
        viewports.push(size);
      },
      context: () => ({ newCDPSession: async () => fakeCdp.cdp }),
      addInitScript: async () => {},
      url: () => validCallbackUrl,
    } as unknown as Playwright.Page;
    const review = await prepareCallbackDocumentReview(
      page,
      baseOrigin,
      viewport,
      {
        deadline: Date.now() + 10_000,
      }
    );
    await expect(review.dispose()).rejects.toThrow();
  });
});

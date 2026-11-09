import { describe, expect, test } from "bun:test";
import type * as Playwright from "@playwright/test";
import { encodeAuthCallbackReturn } from "@/features/account/routes";
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
const accountLanding = { locale: "en-US" } as const;
const czechReturnTo = "/cs-CZ/reservation/cowork?selection=synthetic-1";
const czechReturnValue = encodeAuthCallbackReturn(czechReturnTo) ?? "";
const czechLanding = { locale: "cs-CZ", returnTo: czechReturnTo } as const;
const czechCallbackUrl = `${baseOrigin}/cs-CZ/auth/callback?attempt=550e8400-e29b-41d4-a716-446655440000&return=${czechReturnValue}`;
const englishCopy = {
  label: "Loading sign-in…",
  title: "You are signed in",
  account: "Taking you to your account…",
};
const czechCopy = {
  label: "Načítání přihlášení…",
  title: "Přihlášení proběhlo",
  returning:
    "Vracíme tě zpět. Dokončit můžeš přímo v tomto prohlížeči.",
};

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

type CardTextOverrides = Partial<{
  count: number;
  text: string;
  hidden: boolean;
  ariaHidden: boolean;
}>;

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
      title: CardTextOverrides;
      body: CardTextOverrides;
      hidden: boolean;
      width: number;
      height: number;
      count: number;
    }>;
    readonly fontsStatus?: string;
    readonly locationHref?: string;
    readonly inner?: { width: number; height: number };
    readonly copy?: { readonly title: string; readonly body: string };
  } = {}
) => {
  const copy = overrides.copy ?? {
    title: englishCopy.title,
    body: englishCopy.account,
  };
  const rect = (width: number, height: number) => ({
    width,
    height,
    x: 8,
    y: 8,
  });
  const cardText = (
    text: string,
    textOverrides: CardTextOverrides | undefined
  ) =>
    Array.from({ length: textOverrides?.count ?? 1 }, () => ({
      // Surrounding whitespace is trimmed before comparison.
      textContent: `\n  ${textOverrides?.text ?? text}  `,
      computedStyle: textOverrides?.hidden
        ? { display: "block", visibility: "hidden" }
        : undefined,
      getAttribute: (name: string) =>
        name === "aria-hidden" && textOverrides?.ariaHidden ? "true" : null,
      getBoundingClientRect: () => rect(400, 40),
      parentElement: card,
    }));
  const card: Record<string, unknown> = {
    getAttribute: (name: string) => {
      if (name === "role") return overrides.card?.role ?? "status";
      if (name === "aria-busy") return overrides.card?.ariaBusy ?? "true";
      return overrides.card?.ariaLabel ?? englishCopy.label;
    },
    querySelectorAll: (selector: string) => {
      if (selector === "h1") return cardText(copy.title, overrides.card?.title);
      if (selector === "p") return cardText(copy.body, overrides.card?.body);
      return [];
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
  (globalThis as Record<string, unknown>).getComputedStyle = (node: {
    computedStyle?: unknown;
  }) => node.computedStyle ?? { display: "block", visibility: "visible" };
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
  returnParamName: "return",
  returnValue: null as string | null,
  loadingSelector: '[data-slot="auth-callback-loading"]',
  loadingAriaLabel: englishCopy.label,
  titleText: englishCopy.title,
  bodyText: englishCopy.account,
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
      ["title-missing", { card: { title: { count: 0 } } }],
      ["title-repeated", { card: { title: { count: 2 } } }],
      ["title-wrong-text", { card: { title: { text: "Signing you in" } } }],
      ["title-hidden", { card: { title: { hidden: true } } }],
      ["title-aria-hidden", { card: { title: { ariaHidden: true } } }],
      ["body-missing", { card: { body: { count: 0 } } }],
      [
        "body-returning-instead-of-account",
        {
          card: {
            body: {
              text: "Taking you back to where you left off. You can finish in this browser.",
            },
          },
        },
      ],
      ["body-hidden", { card: { body: { hidden: true } } }],
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

  test("reports a failing card through numeric metrics only", () => {
    const restore = makeSnapshotGlobals({
      card: { title: { text: "Leaked heading" }, body: { count: 0 } },
      locationHref: `${baseOrigin}/en-US/auth/callback?secret=leak`,
    });
    try {
      const payload = collectCallbackDocumentSnapshot(snapshotConfig);
      const parsed = JSON.parse(payload) as {
        v: boolean;
        m: Record<string, unknown>;
      };
      expect(parsed.v).toBe(false);
      expect(parsed.m).toMatchObject({ title: 1, bodyCount: 1, url: 1 });
      expect(
        Object.values(parsed.m).every((value) => typeof value === "number")
      ).toBe(true);
      expect(payload).not.toContain("Leaked");
      expect(payload).not.toContain("leak");
    } finally {
      restore();
    }
  });

  test("accepts the Czech returning callback only with its exact return", () => {
    const czechConfig = {
      ...snapshotConfig,
      callbackPath: "/cs-CZ/auth/callback",
      returnValue: czechReturnValue,
      loadingAriaLabel: czechCopy.label,
      titleText: czechCopy.title,
      bodyText: czechCopy.returning,
    };
    const collect = (overrides: Parameters<typeof makeSnapshotGlobals>[0]) => {
      const restore = makeSnapshotGlobals({
        card: { ariaLabel: czechCopy.label },
        copy: { title: czechCopy.title, body: czechCopy.returning },
        ...overrides,
      });
      try {
        return (
          JSON.parse(collectCallbackDocumentSnapshot(czechConfig)) as {
            v: boolean;
          }
        ).v;
      } finally {
        restore();
      }
    };
    const czechCallback = `${baseOrigin}/cs-CZ/auth/callback`;

    expect(collect({ locationHref: czechCallbackUrl })).toBe(true);
    expect(
      collect({ locationHref: `${czechCallback}?return=${czechReturnValue}` })
    ).toBe(true);
    for (const href of [
      czechCallback,
      `${czechCallback}?attempt=550e8400-e29b-41d4-a716-446655440000`,
      `${czechCallback}?return=${encodeAuthCallbackReturn("/cs-CZ/account")}`,
      `${czechCallback}?return=${czechReturnValue}&return=${czechReturnValue}`,
      `${baseOrigin}/en-US/auth/callback?return=${czechReturnValue}`,
    ]) {
      expect(collect({ locationHref: href })).toBe(false);
    }
    expect(
      collect({
        locationHref: czechCallbackUrl,
        card: { ariaLabel: englishCopy.label },
      })
    ).toBe(false);
    expect(
      collect({
        locationHref: czechCallbackUrl,
        card: {
          ariaLabel: czechCopy.label,
          title: { text: englishCopy.title },
        },
      })
    ).toBe(false);
    expect(
      collect({
        locationHref: czechCallbackUrl,
        card: {
          ariaLabel: czechCopy.label,
          body: { text: "Přesměrujeme tě na účet…" },
        },
      })
    ).toBe(false);
  });

  test("checks fonts and the viewport only for a capture", () => {
    const validationOnlyConfig = { ...snapshotConfig, viewport: null };
    const collect = (overrides: Parameters<typeof makeSnapshotGlobals>[0]) => {
      const restore = makeSnapshotGlobals(overrides);
      try {
        return (
          JSON.parse(collectCallbackDocumentSnapshot(validationOnlyConfig)) as {
            v: boolean;
          }
        ).v;
      } finally {
        restore();
      }
    };

    expect(
      collect({ fontsStatus: "loading", inner: { width: 1024, height: 768 } })
    ).toBe(true);
    expect(collect({ card: { count: 0 } })).toBe(false);
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
      accountLanding,
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

  test("validates without a capture viewport, leaving the page viewport alone", async () => {
    const fake = makeFakePage();
    const review = await prepareCallbackDocumentReview(
      fake.page,
      baseOrigin,
      accountLanding,
      null,
      { deadline: Date.now() + 10_000 }
    );
    admitMainContext(fake.fakeCdp);
    deliverReceipt(fake.fakeCdp);

    review.validate();
    await expect(
      review.capture({ deadline: Date.now() + 10_000 })
    ).rejects.toThrow();
    await review.dispose();

    expect(fake.viewports).toEqual([{ width: 800, height: 600 }]);
    expect(fake.fakeCdp.calls).toContain("detach");
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

  test("validates the live page URL strictly", async () => {
    const { fakeCdp, review } = await prepare({
      url: `${baseOrigin}/en-US/account`,
    });
    admitMainContext(fakeCdp);
    deliverReceipt(fakeCdp);
    expect(() => review.validate()).toThrow();
  });

  test("serializes the Czech landing and validates its exact return", async () => {
    const admitAndValidate = async (url: string) => {
      const fake = makeFakePage({ url });
      const review = await prepareCallbackDocumentReview(
        fake.page,
        baseOrigin,
        czechLanding,
        null,
        { deadline: Date.now() + 10_000 }
      );
      admitMainContext(fake.fakeCdp);
      deliverReceipt(fake.fakeCdp);
      return { fake, review };
    };

    const { fake, review } = await admitAndValidate(czechCallbackUrl);
    review.validate();
    const script = fake.initScripts[0] ?? "";
    for (const value of [
      '"callbackPath":"/cs-CZ/auth/callback"',
      `"returnValue":"${czechReturnValue}"`,
      `"loadingAriaLabel":"${czechCopy.label}"`,
      `"titleText":"${czechCopy.title}"`,
      `"bodyText":"${czechCopy.returning}"`,
    ]) {
      expect(script).toContain(value);
    }
    expect(script).not.toContain("skeleton");
    await review.dispose();

    for (const url of [
      `${baseOrigin}/cs-CZ/auth/callback`,
      `${baseOrigin}/cs-CZ/auth/callback?return=${encodeAuthCallbackReturn("/cs-CZ/account")}`,
      validCallbackUrl,
    ]) {
      const mismatched = await admitAndValidate(url);
      expect(() => mismatched.review.validate()).toThrow();
      await mismatched.review.dispose();
    }
  });

  test("serializes the account landing without a return value", async () => {
    const { initScripts, review } = await prepare();
    const script = initScripts[0] ?? "";
    expect(script).toContain('"callbackPath":"/en-US/auth/callback"');
    expect(script).toContain('"returnValue":null');
    expect(script).toContain(`"bodyText":"${englishCopy.account}"`);
    await review.dispose();
  });

  test("rejects a return target without a callback encoding", async () => {
    const fake = makeFakePage();
    await expect(
      prepareCallbackDocumentReview(
        fake.page,
        baseOrigin,
        { locale: "cs-CZ", returnTo: "/cs-CZ/rezervace-ř" },
        null,
        { deadline: Date.now() + 10_000 }
      )
    ).rejects.toThrow();
    expect(fake.fakeCdp.calls).toHaveLength(0);
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
          accountLanding,
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
      prepareCallbackDocumentReview(
        page,
        baseOrigin,
        accountLanding,
        viewport,
        {
          deadline: Date.now() + 50,
        }
      )
    ).rejects.toThrow();
    expect(fakeCdp.calls).not.toContain("detach");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fakeCdp.calls).toContain("detach");
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
      accountLanding,
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
      accountLanding,
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
      accountLanding,
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
});

/// <reference path="./auth-callback-rsc-fixture.d.ts" />

import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import {
  registerClientReference,
  renderToReadableStream,
} from "next/dist/compiled/react-server-dom-webpack/server.edge";
import React, { Suspense } from "react";
import type { CustomerAccountId } from "@/features/account/customer-account";

type Locale = "en-US" | "cs-CZ";
type CustomerSession = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
  readonly deletionRequested: boolean;
};

type Deferred<A> = {
  readonly promise: Promise<A>;
  readonly resolve: (value: A | PromiseLike<A>) => void;
};

const deferred = <A>(): Deferred<A> => {
  let resolve!: Deferred<A>["resolve"];
  const promise = new Promise<A>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const timeoutMs = {
  stream: 2_000,
  pendingObservation: 250,
} as const;

const loadingLabel = {
  "en-US": "Loading sign-in…",
  "cs-CZ": "Načítání přihlášení…",
} as const;
const accountLabel = {
  "en-US": "My Workspace",
  "cs-CZ": "Můj Workspace",
} as const;

const failureCopy = {
  "en-US": {
    action: "Request a new link",
    title: "This link cannot be used",
  },
  "cs-CZ": {
    action: "Vyžádat nový odkaz",
    title: "Tento odkaz nelze použít",
  },
} as const;

let locale: Locale = "en-US";
let connectionGate = deferred<void>();
let connectionStarted = deferred<void>();
let currentUserReadStarted = deferred<void>();
let currentUserEffect: Effect.Effect<CustomerSession | null, unknown> =
  Effect.succeed(null);
let pendingSession: Deferred<CustomerSession | null> | undefined;

const connection = mock(() => {
  connectionStarted.resolve();
  return connectionGate.promise;
});

mock.module("next/server", () => ({ connection }));
mock.module("next/root-params", () => ({
  locale: () => locale,
}));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("unexpected notFound in auth callback RSC fixture");
  },
}));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled: () => Promise.resolve(true),
}));
mock.module("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    readonly children?: React.ReactNode;
    readonly href: string;
    readonly className?: string;
  }) => React.createElement("a", { className, href }, children),
}));

interface AuthCallbackAuthentication {
  readonly currentUser: typeof currentUserEffect;
}

class Authentication extends Context.Service<
  Authentication,
  AuthCallbackAuthentication
>()("@test/AuthCallbackAuthentication") {}

const AuthenticationLayer = Layer.succeed(Authentication, {
  get currentUser() {
    currentUserReadStarted.resolve();
    return currentUserEffect;
  },
});

const authenticationWithLayers = Object.assign(Authentication, {
  Default: AuthenticationLayer,
  Live: AuthenticationLayer,
});
void authenticationWithLayers;

mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);
const authCallbackRedirectReference = registerClientReference(
  () => {
    throw new Error("AuthCallbackRedirect must remain a client reference");
  },
  "auth-callback-redirect",
  "AuthCallbackRedirect"
);
mock.module("@/features/account/components/auth-callback-redirect", () => ({
  AuthCallbackRedirect: authCallbackRedirectReference,
}));
const clientManifest = {
  "auth-callback-redirect": {
    chunks: [],
    id: "auth-callback-redirect",
    name: "AuthCallbackRedirect",
  },
} satisfies AuthCallbackReactServerManifest;
const runEffect = Effect.runPromise;
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options: { readonly boundary: string }) =>
    <A, E>(effect: Effect.Effect<A, E, never>) =>
      runEffect(effect),
}));

const configure = (options: {
  readonly locale: Locale;
  readonly connection: "pending" | "resolved";
  readonly currentUser: Effect.Effect<CustomerSession | null, unknown>;
}) => {
  locale = options.locale;
  connectionGate = deferred<void>();
  connectionStarted = deferred<void>();
  currentUserReadStarted = deferred<void>();
  currentUserEffect = options.currentUser;
  pendingSession = undefined;
  if (options.connection === "resolved") connectionGate.resolve();
};

const configurePendingSession = (nextLocale: Locale) => {
  const sessionGate = deferred<CustomerSession | null>();
  configure({
    connection: "resolved",
    currentUser: Effect.promise(() => sessionGate.promise),
    locale: nextLocale,
  });
  pendingSession = sessionGate;
};

const activeSession = {
  accountId: "auth-account-callback" as CustomerAccountId,
  deletionRequested: false,
  email: "ada@example.test",
} satisfies CustomerSession;

const FixtureShell = ({ children }: { readonly children: React.ReactNode }) =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement("header", { "data-fixture-shell": "header" }),
    children,
    React.createElement("footer", { "data-fixture-shell": "footer" })
  );

const importCallbackModel = async () => {
  const { default: CustomerAuthCallbackPage } = await import(
    "@/app/[locale]/(minimal-header)/auth/callback/page"
  );

  return React.createElement(
    Suspense,
    { fallback: null },
    React.createElement(CustomerAuthCallbackPage)
  );
};

const renderModel = (model: React.ReactNode) =>
  renderToReadableStream(
    React.createElement(FixtureShell, null, model),
    clientManifest
  );

const renderCallback = async () => renderModel(await importCallbackModel());

class ReadDeadlineExceeded extends Error {
  constructor() {
    super("RSC stream read deadline exceeded");
  }
}

const readWithDeadline = async <A>(
  operation: Promise<A>,
  deadline: number
): Promise<A> => {
  const remaining = Math.max(0, deadline - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadDeadlineExceeded()), remaining);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const readUntil = async (
  stream: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
  limitMs: number,
  finishPendingRender: () => void
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + limitMs;
  let text = "";

  try {
    while (Date.now() < deadline) {
      const result = await readWithDeadline(reader.read(), deadline);
      if (result.done) break;
      text += decoder.decode(result.value, { stream: true });
      if (predicate(text)) break;
    }
  } catch (cause) {
    if (!(cause instanceof ReadDeadlineExceeded)) throw cause;
  } finally {
    finishPendingRender();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return text;
};

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs.stream;
  let text = "";

  try {
    while (Date.now() < deadline) {
      const result = await readWithDeadline(reader.read(), deadline);
      if (result.done) return text;
      text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  throw new ReadDeadlineExceeded();
};

const observeWhileConnectionIsBlocked = async (nextLocale: Locale) => {
  configure({
    connection: "pending",
    currentUser: Effect.succeed(null),
    locale: nextLocale,
  });
  const stream = await renderCallback();
  await readWithDeadline(
    connectionStarted.promise,
    Date.now() + timeoutMs.stream
  );

  return readUntil(
    stream,
    (text) => {
      const model = loadingModel(text, nextLocale);
      return model.hasLoadingLabel && model.hasMain && model.hasStatus;
    },
    timeoutMs.pendingObservation,
    () => {
      connectionGate.resolve();
      pendingSession?.resolve(null);
    }
  );
};

const observeWhileSessionIsBlocked = async (nextLocale: Locale) => {
  configurePendingSession(nextLocale);
  const stream = await renderCallback();
  await readWithDeadline(
    connectionStarted.promise,
    Date.now() + timeoutMs.stream
  );
  connectionGate.resolve();
  await readWithDeadline(
    currentUserReadStarted.promise,
    Date.now() + timeoutMs.stream
  );

  return readUntil(
    stream,
    (text) => {
      const model = loadingModel(text, nextLocale);
      return model.hasLoadingLabel && model.hasMain && model.hasStatus;
    },
    timeoutMs.pendingObservation,
    () => {
      connectionGate.resolve();
      pendingSession?.resolve(null);
    }
  );
};

const settledOutput = async (
  nextLocale: Locale,
  nextCurrentUser: Effect.Effect<CustomerSession | null, unknown>
) => {
  configure({
    connection: "resolved",
    currentUser: nextCurrentUser,
    locale: nextLocale,
  });
  return readAll(await renderCallback());
};

const loadingModel = (output: string, nextLocale: Locale) => ({
  hasLoadingLabel: output.includes(
    `"aria-label":${JSON.stringify(loadingLabel[nextLocale])}`
  ),
  hasMain: output.includes('["$","main",'),
  hasStatus: output.includes('"role":"status"'),
});

const callbackLoadingModel = (output: string, nextLocale: Locale) => ({
  ...loadingModel(output, nextLocale),
  hasAccountLink:
    output.includes(`"href":"/${nextLocale}/account"`) &&
    output.includes(accountLabel[nextLocale]),
});

const signInLoadingOutput = async (nextLocale: Locale) => {
  const { SignInLoading } = await import(
    "@/features/account/components/sign-in-loading"
  );
  return readAll(
    await renderModel(
      React.createElement(SignInLoading, { locale: nextLocale })
    )
  );
};

afterEach(() => {
  connectionGate.resolve();
  pendingSession?.resolve(null);
});

describe("auth callback RSC regression", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "recognizes the actual localized SignInLoading RSC model for %s",
    async (nextLocale) => {
      const output = await signInLoadingOutput(nextLocale);

      expect(loadingModel(output, nextLocale)).toEqual({
        hasLoadingLabel: true,
        hasMain: true,
        hasStatus: true,
      });
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "streams the localized loading main while %s connection is pending",
    async (nextLocale) => {
      const output = await observeWhileConnectionIsBlocked(nextLocale);

      expect(callbackLoadingModel(output, nextLocale)).toEqual({
        hasLoadingLabel: true,
        hasMain: true,
        hasStatus: true,
        hasAccountLink: true,
      });
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "streams the localized loading main while %s session is pending",
    async (nextLocale) => {
      const output = await observeWhileSessionIsBlocked(nextLocale);

      expect(callbackLoadingModel(output, nextLocale)).toEqual({
        hasLoadingLabel: true,
        hasMain: true,
        hasStatus: true,
        hasAccountLink: true,
      });
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders the existing failure link for an absent %s session",
    async (nextLocale) => {
      const output = await settledOutput(nextLocale, Effect.succeed(null));

      expect(output).toContain(failureCopy[nextLocale].title);
      expect(output).toContain(failureCopy[nextLocale].action);
      expect(output).toContain(`/${nextLocale}/auth/sign-in`);
      expect(output).not.toContain("AuthCallbackRedirect");
      expect(output).not.toContain("NEXT_REDIRECT");
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders the existing failure link for a %s service failure",
    async (nextLocale) => {
      const output = await settledOutput(
        nextLocale,
        Effect.fail("synthetic authentication failure")
      );

      expect(output).toContain(failureCopy[nextLocale].title);
      expect(output).toContain(failureCopy[nextLocale].action);
      expect(output).toContain(`/${nextLocale}/auth/sign-in`);
      expect(output).not.toContain("AuthCallbackRedirect");
      expect(output).not.toContain("NEXT_REDIRECT");
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "serializes the localized client account handoff for an authenticated %s session",
    async (nextLocale) => {
      const output = await settledOutput(
        nextLocale,
        Effect.succeed(activeSession)
      );

      expect(output).toContain(
        'I["auth-callback-redirect",[],"AuthCallbackRedirect"]'
      );
      expect(output).toContain("AuthCallbackRedirect");
      expect(output).toContain(`"locale":"${nextLocale}"`);
      expect(output).not.toContain("NEXT_REDIRECT");
      expect(output).not.toContain(failureCopy[nextLocale].title);
    }
  );
});

process.stdout.write("AUTH_CALLBACK_RSC_REGRESSION_PROOF\n");

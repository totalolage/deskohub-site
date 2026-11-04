import { type Mock, mock } from "bun:test";
import type { checkBotId as realCheckBotId } from "botid/server";
import type { TestAdministratorAccessControl } from "@/features/administrators/server/administrator-access.test-utils";

type BotIdVerification = Awaited<ReturnType<typeof realCheckBotId>>;

/** A cookie the action code set or deleted through `cookies()`. */
interface WorkspaceActionCookieWrite {
  readonly name: string;
  /** Undefined when the code deleted the cookie. */
  readonly value: string | undefined;
}

export interface WorkspaceActionRequestOptions {
  /**
   * The request's `referer`, which the action boundary derives the locale
   * from. Defaults to the en-US home page; `null` sends none.
   */
  readonly referer?: string | null;
  /**
   * Enforces BotID and answers every check with this verdict. Without it,
   * BotID is not enforced, as on development and preview deployments.
   */
  readonly botId?: "human" | "bot";
}

export interface WorkspaceActionRequest {
  /** Sets the request's `referer`; `null` removes it. */
  readonly setReferer: (referer: string | null) => void;
  /** Sets a request cookie; `undefined` removes it. */
  readonly setCookie: (name: string, value: string | undefined) => void;
  /** The current value of a request cookie, writes included. */
  readonly cookie: (name: string) => string | undefined;
  /** Every cookie write through `cookies()`, in order. */
  readonly cookieWrites: () => readonly WorkspaceActionCookieWrite[];
  /**
   * Called with each callback handed to `next/server`'s `after`, which never
   * runs it. Give it an implementation to observe when callbacks are
   * scheduled.
   */
  readonly after: Mock<(callback: () => unknown) => void>;
  /** BotID's check, called only while BotID is enforced. */
  readonly checkBotId: Mock<() => Promise<BotIdVerification>>;
  /**
   * Returns to the installed referer, with no cookies or cookie writes and
   * fresh `after` and `checkBotId` mocks.
   */
  readonly reset: () => void;
}

const defaultReferer = "https://deskohub.test/en-US";

const botIdVerdicts = {
  human: { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false },
  bot: { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false },
} satisfies Record<"human" | "bot", BotIdVerification>;

/**
 * Stands in for the Next.js request APIs a Server Action reads outside a
 * Next request: `headers()` and `cookies()` from `next/headers`, `after` and
 * `connection` from `next/server`, the en-US `next/root-params` locale, and
 * BotID's check. The rest of `next/server` is what the file had installed
 * before the call, the real module unless an earlier mock replaced it. The
 * action boundary itself runs for real.
 *
 * Module mocks are process-wide and bind at import, so call this once per
 * test file before importing the action module, and `reset()` between
 * tests. Administration actions also need someone to act as: use
 * `mockAdministrationActionRequest`.
 */
export const mockWorkspaceActionRequest = async (
  options: WorkspaceActionRequestOptions = {}
): Promise<WorkspaceActionRequest> => {
  const nextServer = await import("next/server");

  const initialReferer =
    options.referer === undefined ? defaultReferer : options.referer;
  let referer = initialReferer;
  const jar = new Map<string, string>();
  const writes: WorkspaceActionCookieWrite[] = [];
  const verdict = botIdVerdicts[options.botId ?? "human"];
  const answerBotId = (): Promise<BotIdVerification> =>
    Promise.resolve({ ...verdict });

  const after = mock((_callback: () => unknown) => undefined);
  const checkBotId = mock(answerBotId);

  const writeCookie = (name: string, value: string | undefined) => {
    writes.push({ name, value });
    if (value === undefined) jar.delete(name);
    else jar.set(name, value);
  };
  // The `cookies()` store by cookie name, as Workspace code calls it.
  const cookieStore = {
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      writeCookie(name, value);
      return cookieStore;
    },
    delete: (name: string) => {
      writeCookie(name, undefined);
      return cookieStore;
    },
  };

  mock.module("next/headers", () => ({
    cookies: async () => cookieStore,
    headers: async () =>
      new Headers(referer === null ? undefined : { referer }),
  }));
  mock.module("next/server", () => ({
    ...nextServer,
    after: (callback: () => unknown) => after(callback),
    connection: () => Promise.resolve(),
  }));
  mock.module("next/root-params", () => ({
    locale: () => Promise.resolve("en-US"),
  }));
  mock.module("botid/server", () => ({
    checkBotId: () => checkBotId(),
  }));
  mock.module("@/shared/backend/bot-protection/bot-protection.runtime", () => ({
    isWorkspaceBotIdEnforcedAtRuntime: () => options.botId !== undefined,
  }));

  return {
    setReferer: (next) => {
      referer = next;
    },
    setCookie: (name, value) => {
      if (value === undefined) jar.delete(name);
      else jar.set(name, value);
    },
    cookie: (name) => jar.get(name),
    cookieWrites: () => [...writes],
    after,
    checkBotId,
    reset: () => {
      referer = initialReferer;
      jar.clear();
      writes.length = 0;
      after.mockReset();
      checkBotId.mockReset();
      checkBotId.mockImplementation(answerBotId);
    },
  };
};

export interface AdministrationActionRequestOptions
  extends WorkspaceActionRequestOptions {
  /** Names the administrator's test email address. */
  readonly administrator?: string;
}

export interface AdministrationActionRequest extends WorkspaceActionRequest {
  /**
   * Who the request acts as: the administrator it starts as, the account the
   * session reads as now, and whether that account is signed in and holds
   * the grant.
   */
  readonly access: TestAdministratorAccessControl;
  /**
   * Also returns the request to its administrator, with the grant and a zero
   * session read count.
   */
  readonly reset: () => void;
}

/**
 * `mockWorkspaceActionRequest` for an administration action: the request also
 * acts as an administrator, through the real administration guards. Pick
 * another account with `access.actAs`, or drop the session or grant with
 * `access.set`; `reset()` returns to the administrator.
 */
export const mockAdministrationActionRequest = async ({
  administrator,
  ...options
}: AdministrationActionRequestOptions = {}): Promise<AdministrationActionRequest> => {
  // Loaded here so requests outside administration never load the
  // authentication and grant services it substitutes.
  const { mockAdministratorAccess } = await import(
    "@/features/administrators/server/administrator-access.test-utils"
  );
  const access = mockAdministratorAccess(administrator);
  const request = await mockWorkspaceActionRequest(options);

  return {
    ...request,
    access,
    reset: () => {
      request.reset();
      access.reset();
    },
  };
};

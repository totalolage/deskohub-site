import { expect, test } from "bun:test";
import {
  attachVirtualAuthenticator,
  type VirtualAuthenticatorSession,
  virtualPlatformAuthenticatorOptions,
} from "./virtual-authenticator";

type SentCommand = { readonly method: string; readonly params?: unknown };

const makeSession = (
  options: { readonly failAdd?: boolean } = {}
): VirtualAuthenticatorSession & {
  readonly commands: SentCommand[];
  detached: number;
} => {
  const commands: SentCommand[] = [];
  const session = {
    commands,
    detached: 0,
    detach: async () => {
      session.detached += 1;
    },
    send: async (method: string, params?: unknown) => {
      commands.push({ method, params });
      if (method === "WebAuthn.addVirtualAuthenticator") {
        if (options.failAdd) throw new Error("WebAuthn is unavailable");
        return { authenticatorId: "authenticator-1" };
      }
      if (method === "WebAuthn.getCredentials") {
        return {
          credentials: [
            {
              credentialId: "secret-credential-id",
              isResidentCredential: true,
              privateKey: "secret-private-key",
              rpId: "preview.example.test",
              signCount: 1,
              userHandle: "secret-user-handle",
            },
          ],
        };
      }
      return {};
    },
  };
  return session as unknown as VirtualAuthenticatorSession & {
    readonly commands: SentCommand[];
    detached: number;
  };
};

test("adds a CTAP2 internal discoverable authenticator that waits for presence", async () => {
  const session = makeSession();
  await attachVirtualAuthenticator(session);

  expect(session.commands).toEqual([
    { method: "WebAuthn.enable", params: { enableUI: false } },
    {
      method: "WebAuthn.addVirtualAuthenticator",
      params: { options: virtualPlatformAuthenticatorOptions },
    },
  ]);
  expect(virtualPlatformAuthenticatorOptions).toEqual({
    automaticPresenceSimulation: false,
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    protocol: "ctap2",
    transport: "internal",
  });
});

test("reads credentials without exposing their identifiers or keys", async () => {
  const authenticator = await attachVirtualAuthenticator(makeSession());

  expect(await authenticator.readCredentials()).toEqual([
    { isResidentCredential: true, rpId: "preview.example.test" },
  ]);
});

test("simulates presence only while a ceremony runs", async () => {
  const session = makeSession();
  const authenticator = await attachVirtualAuthenticator(session);
  const presence = (enabled: boolean) => ({
    method: "WebAuthn.setAutomaticPresenceSimulation",
    params: { authenticatorId: "authenticator-1", enabled },
  });

  const result = await authenticator.answerCeremony(async () => {
    expect(session.commands.at(-1)).toEqual(presence(true));
    return "signed in";
  });
  await expect(
    authenticator.answerCeremony(async () => {
      throw new Error("ceremony failed");
    })
  ).rejects.toThrow("ceremony failed");

  expect(result).toBe("signed in");
  expect(session.commands.slice(2)).toEqual([
    presence(true),
    presence(false),
    presence(true),
    presence(false),
  ]);
});

test("removes the authenticator once and detaches its session", async () => {
  const session = makeSession();
  const authenticator = await attachVirtualAuthenticator(session);

  await Promise.all([authenticator.remove(), authenticator.remove()]);
  await authenticator.remove();

  expect(session.commands.slice(2)).toEqual([
    {
      method: "WebAuthn.removeVirtualAuthenticator",
      params: { authenticatorId: "authenticator-1" },
    },
    { method: "WebAuthn.disable", params: undefined },
  ]);
  expect(session.detached).toBe(1);
});

test("detaches the session when the authenticator cannot be added", async () => {
  const session = makeSession({ failAdd: true });

  await expect(attachVirtualAuthenticator(session)).rejects.toThrow(
    "WebAuthn is unavailable"
  );
  expect(session.detached).toBe(1);
});

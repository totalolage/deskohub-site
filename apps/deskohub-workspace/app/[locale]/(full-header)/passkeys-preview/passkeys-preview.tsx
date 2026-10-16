"use client";

// TEMPORARY passkey prototype harness (#635). Delete this route once the
// client slice wires the real screens.

import { useState } from "react";
import type { AuthReturnLifecycle } from "@/features/account/auth-return";
import { AccountReauthenticationStep } from "@/features/account/components/account-reauthentication-step";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { DeleteAccountCard } from "@/features/account/components/delete-account-card";
import { PasskeyPromptDialog } from "@/features/account/components/passkeys/passkey-prompt-dialog";
import { SignInSecurityScreen } from "@/features/account/components/passkeys/sign-in-security-screen";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import {
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import type {
  AccountPasskey,
  PasskeyCreationResult,
} from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";

const syntheticEmail = "jana.novakova@example.com";
const syntheticPasskeys: readonly AccountPasskey[] = [
  {
    id: "pk-1",
    name: "iCloud Keychain",
    provider: "iCloud Keychain",
    createdAt: "2026-09-02T08:15:00Z",
  },
  {
    id: "pk-2",
    name: "Work laptop",
    provider: "Google Password Manager",
    createdAt: "2026-10-14T16:40:00Z",
  },
];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const fakeAuthReturn: AuthReturnLifecycle = {
  cancel: () => undefined,
  sendSignInEmail: async () => {
    await wait(300);
    return { status: "sent", signInCode: true };
  },
  verifySignInCode: async () => {
    await wait(300);
    return "verified";
  },
  continueWithVerifiedCode: () => false,
  continueIfSignedIn: async () => false,
};

export type PasskeysPreviewState = {
  readonly view: "security" | "prompt" | "delete-account";
  readonly passkeys: 0 | 1 | 2;
  readonly session: "fresh" | "stale";
  readonly outcome: "succeeds" | "fails" | "wrong-account";
};

export function PasskeysPreview({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: PasskeysPreviewState;
}) {
  const copy = getAccountScreenCopy(locale);
  const [activeSection, setActiveSection] = useState<AccountSection>(
    { security: "security", prompt: "reservations", "delete-account": "danger" }[
      state.view
    ] as AccountSection
  );
  const [passkeys, setPasskeys] = useState(
    syntheticPasskeys.slice(0, state.passkeys)
  );
  const [stale, setStale] = useState(state.session === "stale");
  const [promptOpen, setPromptOpen] = useState(state.view === "prompt");

  const createPasskey = async (): Promise<PasskeyCreationResult> => {
    await wait(700);
    if (stale) return "reauthentication-required";
    if (state.outcome === "fails") return "failed";
    setPasskeys((current) => [
      ...current,
      {
        id: `pk-${current.length + 3}`,
        name: "Chrome on Android",
        provider: "Google Password Manager",
        createdAt: "2026-10-16T09:00:00Z",
      },
    ]);
    return "created";
  };

  return (
    <AccountShell
      activeSection={activeSection}
      labels={copy.shell}
      onSectionChange={setActiveSection}
      reservationCount={2}
      signOut={
        <Button tone="danger" type="button" wrap>
          {m.accountSignOut({}, { locale })}
        </Button>
      }
      title={m.accountTitle({}, { locale })}
    >
      {activeSection === "security" && (
        <SignInSecurityScreen
          authReturn={{
            ...fakeAuthReturn,
            verifySignInCode: async (...args) => {
              const result = await fakeAuthReturn.verifySignInCode(...args);
              setStale(false);
              return result;
            },
          }}
          confirmWithPasskey={
            passkeys.length > 0
              ? async () => {
                  await wait(600);
                  if (state.outcome === "wrong-account") return "wrong-account";
                  setStale(false);
                  return "confirmed";
                }
              : undefined
          }
          createPasskey={createPasskey}
          deletePasskey={async (id) => {
            await wait(500);
            if (state.outcome === "fails") return "failed";
            setPasskeys((current) => current.filter((p) => p.id !== id));
            return "saved";
          }}
          email={syntheticEmail}
          locale={locale}
          passkeys={passkeys}
          renamePasskey={async (id, name) => {
            await wait(500);
            if (state.outcome === "fails") return "failed";
            setPasskeys((current) =>
              current.map((p) => (p.id === id ? { ...p, name } : p))
            );
            return "saved";
          }}
        />
      )}
      {activeSection === "danger" && (
        <>
          <DeleteAccountCard
            deletionPending={false}
            email={syntheticEmail}
            heading={copy.dangerTitle}
            locale={locale}
          />
          <Dialog defaultOpen>
            <DialogContent
              aria-describedby="delete-account-dialog-description"
              locale={locale}
            >
              <AccountReauthenticationStep
                purpose="delete-account"
                authReturn={fakeAuthReturn}
                confirmWithPasskey={
                  passkeys.length > 0
                    ? async () => {
                        await wait(600);
                        return state.outcome === "wrong-account"
                          ? "wrong-account"
                          : "confirmed";
                      }
                    : undefined
                }
                email={syntheticEmail}
                locale={locale}
                onReauthenticated={() => undefined}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
      {activeSection !== "security" && activeSection !== "danger" && (
        <AccountSectionPanel title={copy.shell.sections[activeSection]}>
          <div className="space-y-3">
            {["Hot desk · 21 Oct 2026", "Meeting room · 28 Oct 2026"].map(
              (row) => (
                <div
                  className="rounded-xl border border-[#dfe4ec] p-4 text-sm text-navy-blue/78"
                  key={row}
                >
                  {row}
                </div>
              )
            )}
          </div>
        </AccountSectionPanel>
      )}
      <PasskeyPromptDialog
        createPasskey={async () => {
          await wait(700);
          return state.outcome === "fails" ? "failed" : "created";
        }}
        locale={locale}
        onCreated={() => setPromptOpen(false)}
        onDismiss={() => setPromptOpen(false)}
        open={promptOpen}
      />
    </AccountShell>
  );
}

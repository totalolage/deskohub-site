"use client";

import { KeyRound, Pencil, Trash2 } from "lucide-react";
import {
  type AccountPasskey,
  passkeyDisplayName,
} from "@/features/account/passkeys";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { workspaceSiteConstants } from "@/shared/utils";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import { AddPasskeyButtonLabel } from "./add-passkey-dialog";

type AccountPasskeyListProps = {
  readonly locale: Locale;
  /** Null when the list couldn't be read. */
  readonly passkeys: readonly AccountPasskey[] | null;
  readonly creating: boolean;
  readonly onCreate: () => void;
  readonly onRename: (passkey: AccountPasskey) => void;
  readonly onDelete: (passkey: AccountPasskey) => void;
};

/**
 * The account's passkeys with their rename and delete actions, an invitation
 * to create the first one, or a notice that the list couldn't be read.
 */
export function AccountPasskeyList({
  locale,
  passkeys,
  creating,
  onCreate,
  onRename,
  onDelete,
}: AccountPasskeyListProps) {
  if (passkeys === null) {
    return (
      <p
        className="mt-5 rounded-xl border border-[#dfe4ec] px-4 py-5 text-sm leading-6 text-navy-blue/68"
        id="account-security-passkeys-unavailable"
      >
        {m.accountSecurityPasskeysUnavailable({}, { locale })}
      </p>
    );
  }
  if (passkeys.length === 0) {
    return (
      <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-[#cfd6e0] bg-[#fbfcfd] px-6 py-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-burned-orange shadow-[0_12px_28px_-18px_rgba(0,2,79,0.45)]">
          <KeyRound aria-hidden className="size-6" />
        </span>
        <p className="mt-4 font-semibold text-navy-blue">
          {m.accountSecurityPasskeysEmptyTitle({}, { locale })}
        </p>
        <Button
          className="mt-5"
          disabled={creating}
          id="account-security-add-passkey"
          onClick={onCreate}
          type="button"
        >
          <AddPasskeyButtonLabel
            creating={creating}
            locale={locale}
            variant="create"
          />
        </Button>
      </div>
    );
  }
  return (
    <ul
      aria-labelledby="account-security-passkeys-title"
      className="mt-5 divide-y divide-[#e6ebf1] rounded-xl border border-[#dfe4ec]"
    >
      {passkeys.map((passkey) => (
        <AccountPasskeyListItem
          key={passkey.id}
          locale={locale}
          onDelete={() => onDelete(passkey)}
          onRename={() => onRename(passkey)}
          passkey={passkey}
        />
      ))}
    </ul>
  );
}

function AccountPasskeyListItem({
  locale,
  passkey,
  onRename,
  onDelete,
}: {
  readonly locale: Locale;
  readonly passkey: AccountPasskey;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  const name = passkeyDisplayName(passkey, locale);
  const date = formatInstantDate({
    instant: Temporal.Instant.from(passkey.createdAt),
    locale,
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  return (
    <li
      className="flex min-w-0 items-center gap-2 py-3 pr-2 pl-4 @xl:gap-4 @xl:p-4"
      data-passkey-id={passkey.id}
    >
      <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-[#f4f3ef] text-navy-blue @xl:flex">
        <KeyRound aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-navy-blue">{name}</p>
        <p className="mt-0.5 text-sm text-navy-blue/60">
          {passkey.provider === undefined || passkey.provider === name
            ? m.accountSecurityPasskeyCreatedOn({ date }, { locale })
            : m.accountSecurityPasskeyDetails(
                { provider: passkey.provider, date },
                { locale }
              )}
        </p>
      </div>
      <div className="flex shrink-0 items-center @xl:gap-1">
        <Button
          aria-label={m.accountSecurityPasskeyRenameLabel({ name }, { locale })}
          onClick={onRename}
          shape="rounded"
          size="sm"
          tone="navy-blue"
          type="button"
          variant="ghost"
        >
          <Pencil aria-hidden className="size-4" />
          <span className="hidden @xl:inline">
            {m.accountSecurityPasskeyRename({}, { locale })}
          </span>
        </Button>
        <Button
          aria-label={m.accountSecurityPasskeyDeleteLabel({ name }, { locale })}
          onClick={onDelete}
          shape="rounded"
          size="sm"
          tone="danger"
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden className="size-4" />
          <span className="hidden @xl:inline">
            {m.accountSecurityPasskeyDelete({}, { locale })}
          </span>
        </Button>
      </div>
    </li>
  );
}

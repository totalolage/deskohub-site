"use client";

import { Camera, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useRef, useState, useTransition } from "react";
import {
  type CustomerAvatarMutationResult,
  type CustomerAvatarView,
  removeCustomerAvatar,
  uploadCustomerAvatar,
} from "@/features/account/avatar-actions";
import type { CustomerAvatarRejectionReason } from "@/features/account/backend/customer-avatar.service";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type AvatarStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "succeeded"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/*
 * Owns the profile avatar media and its independent mutations. Upload and
 * remove run as their own Server Action calls with their own FormData, so
 * unsaved profile-form edits are never submitted, never reset, and never
 * counted as dirty by the surrounding form.
 */
export function AvatarControl({
  avatar,
  firstName,
  lastName,
  locale,
}: {
  readonly avatar: CustomerAvatarView | null;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly locale: Locale;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayAvatar, setDisplayAvatar] = useState(avatar);
  const [imageFailed, setImageFailed] = useState(false);
  const [status, setStatus] = useState<AvatarStatus>({ kind: "idle" });
  const [, startRefreshTransition] = useTransition();
  const [lastPropAvatar, setLastPropAvatar] = useState(avatar);
  if (avatar !== lastPropAvatar) {
    // Adopt fresh page data after router.refresh() and drop any load failure
    // keyed to the previous URL, adjusting state during render per React's
    // prop-to-state guidance.
    setLastPropAvatar(avatar);
    setDisplayAvatar(avatar);
    setImageFailed(false);
  }

  const handleOutcome = (outcome: CustomerAvatarMutationResult) => {
    if (outcome.status === "uploaded") {
      setDisplayAvatar(outcome.avatar);
      setImageFailed(false);
      setStatus({
        kind: "succeeded",
        message: m.accountProfileAvatarUpdated({}, { locale }),
      });
      startRefreshTransition(() => router.refresh());
      return;
    }
    if (outcome.status === "removed") {
      setDisplayAvatar(null);
      setImageFailed(false);
      setStatus({
        kind: "succeeded",
        message: m.accountProfileAvatarRemoved({}, { locale }),
      });
      startRefreshTransition(() => router.refresh());
      return;
    }
    if (outcome.status === "retryable") {
      setStatus({
        kind: "failed",
        message: m.accountProfileAvatarErrorRetryable({}, { locale }),
      });
      return;
    }
    const rejectionMessages = {
      "file-missing": m.accountProfileAvatarErrorFileMissing({}, { locale }),
      "file-too-large": m.accountProfileAvatarErrorFileTooLarge({}, { locale }),
      "image-dimensions-too-large": m.accountProfileAvatarErrorDimensions(
        {},
        { locale }
      ),
      "undecodable-image": m.accountProfileAvatarErrorUndecodable(
        {},
        { locale }
      ),
      "unsupported-format": m.accountProfileAvatarErrorUnsupportedFormat(
        {},
        { locale }
      ),
    } satisfies Record<CustomerAvatarRejectionReason, string>;
    setStatus({
      kind: "failed",
      message: rejectionMessages[outcome.reason],
    });
  };

  // Server-side input validation and transport failures both surface in the
  // aria-live status region while the previous image or initials stay put.
  const reportFailure = (message: string) =>
    setStatus({ kind: "failed", message });

  const upload = useWorkspaceAction(uploadCustomerAvatar, {
    onSuccess: ({ data }) => {
      if (data) handleOutcome(data);
    },
    onError: ({ error }) => {
      reportFailure(
        error.validationErrors
          ? m.accountProfileAvatarErrorFileMissing({}, { locale })
          : m.accountProfileAvatarErrorGeneric({}, { locale })
      );
    },
    onTransportError: () =>
      reportFailure(m.accountProfileAvatarErrorGeneric({}, { locale })),
  });
  const remove = useWorkspaceAction(removeCustomerAvatar, {
    onSuccess: ({ data }) => {
      if (data) handleOutcome(data);
    },
    onError: () =>
      reportFailure(m.accountProfileAvatarErrorGeneric({}, { locale })),
    onTransportError: () =>
      reportFailure(m.accountProfileAvatarErrorGeneric({}, { locale })),
  });

  const isPending = upload.isExecuting || remove.isExecuting;

  const serverError = upload.result.serverError ?? remove.result.serverError;

  // Beginning any new mutation clears both stored action results so a
  // previous action's serverError can never mask a later action's outcome,
  // and resets the aria-live status for the new attempt.
  const beginMutation = () => {
    upload.reset();
    remove.reset();
    setStatus({ kind: "idle" });
  };

  const openFilePicker = () => {
    beginMutation();
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Keep the picker usable for a retry regardless of the outcome.
    event.target.value = "";
    if (!file) return;
    beginMutation();
    const formData = new FormData();
    formData.set("file", file);
    upload.execute(formData);
  };

  const handleRemove = () => {
    beginMutation();
    remove.execute(undefined);
  };

  return (
    <div className="flex w-48 shrink-0 flex-col items-start gap-2">
      <div className="relative size-20">
        <AvatarPortrait
          avatar={displayAvatar}
          imageFailed={imageFailed}
          initials={avatarInitials(firstName, lastName)}
          locale={locale}
          onImageError={() => setImageFailed(true)}
        />
        <span className="absolute -right-1 -bottom-1 inline-flex size-10">
          <Button
            aria-label={m.accountProfileAvatarChange({}, { locale })}
            disabled={isPending}
            onClick={openFilePicker}
            size="icon"
            type="button"
            variant="secondary"
          >
            <Camera aria-hidden="true" className="size-4" strokeWidth={2} />
          </Button>
        </span>
        <input
          accept=".jpg,.jpeg,.png,.webp"
          aria-hidden="true"
          className="sr-only"
          onChange={handleFileChange}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>
      {displayAvatar !== null && (
        <Button
          caps
          disabled={isPending}
          onClick={handleRemove}
          shape="rounded"
          size="sm"
          type="button"
          variant="secondary"
          wrap
        >
          {remove.isExecuting
            ? m.accountProfileAvatarRemoving({}, { locale })
            : m.accountProfileAvatarRemove({}, { locale })}
        </Button>
      )}
      <p className="max-w-48 text-xs leading-4 text-[#52647c]">
        {m.accountProfileAvatarHint({}, { locale })}
      </p>
      <AvatarStatusRegion
        failed={Boolean(serverError) || status.kind === "failed"}
        message={avatarStatusMessage({
          locale,
          removing: remove.isExecuting,
          serverError,
          status,
          uploading: upload.isExecuting,
        })}
      />
    </div>
  );
}

function avatarInitials(firstName: string, lastName: string | null) {
  return [firstName, lastName ?? ""]
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => Array.from(name)[0])
    .filter((initial): initial is string => initial !== undefined)
    .join("");
}

// Shows the avatar image, or the initials (else a placeholder icon) when there
// is no avatar or its image failed to load.
function AvatarPortrait({
  avatar,
  imageFailed,
  initials,
  locale,
  onImageError,
}: {
  readonly avatar: CustomerAvatarView | null;
  readonly imageFailed: boolean;
  readonly initials: string;
  readonly locale: Locale;
  readonly onImageError: () => void;
}) {
  const showImage = avatar !== null && !imageFailed;
  return (
    <>
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,#cf7253_0%,#00024f_100%)] text-2xl font-bold text-white"
      >
        {showImage
          ? null
          : initials || <UserRound className="size-9" strokeWidth={1.8} />}
      </div>
      {showImage && (
        // biome-ignore lint/performance/noImgElement: provider-delivered, already-normalized 512px WebP avatar; next/image optimization does not apply
        <img
          alt={m.accountProfileAvatarAlt({}, { locale })}
          className="absolute inset-0 size-20 rounded-full object-cover"
          onError={onImageError}
          src={avatar.url}
        />
      )}
    </>
  );
}

// A pending mutation announces itself; otherwise the latest server error or
// settled outcome stays in the status region.
function avatarStatusMessage({
  locale,
  removing,
  serverError,
  status,
  uploading,
}: {
  readonly locale: Locale;
  readonly removing: boolean;
  readonly serverError: string | undefined;
  readonly status: AvatarStatus;
  readonly uploading: boolean;
}) {
  if (uploading) return m.accountProfileAvatarUploading({}, { locale });
  if (removing) return m.accountProfileAvatarRemoving({}, { locale });
  return serverError ?? (status.kind === "idle" ? null : status.message);
}

function AvatarStatusRegion({
  failed,
  message,
}: {
  readonly failed: boolean;
  readonly message: string | null;
}) {
  return (
    <div aria-live="polite" className="min-h-5 text-sm" role="status">
      {message && (
        <p className={failed ? "text-red-700" : "text-emerald-800"}>
          {message}
        </p>
      )}
    </div>
  );
}

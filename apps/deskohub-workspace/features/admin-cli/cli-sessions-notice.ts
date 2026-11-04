import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** The notice for the `result` a CLI session revocation redirects back with. */
export const getCliSessionsNotice = (
  result: string | undefined,
  locale: Locale
) => {
  if (result === "revoked") {
    return {
      message: m.adminCliSessionsRevokedNotice({}, { locale }),
      status: "success" as const,
    };
  }
  if (result === "unchanged") {
    return {
      message: m.adminCliSessionsUnchangedNotice({}, { locale }),
      status: "error" as const,
    };
  }
  return undefined;
};

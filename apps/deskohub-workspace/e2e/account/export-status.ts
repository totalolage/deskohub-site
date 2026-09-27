import { m } from "@/features/i18n";

/**
 * The localized copy the serial account lane expects from the export
 * control. Every expectation consumes the same Inlang catalog message the
 * component renders, so a catalog edit can never desynchronize the lane
 * from the page the way a duplicated literal would.
 */
export const accountDataExportDeliveredStatusMessage = (): string =>
  m.legalScreenExportDeliveredStatus({}, { locale: "en-US" });

export const accountDataExportActionMessage = (): string =>
  m.legalScreenExportAction({}, { locale: "en-US" });

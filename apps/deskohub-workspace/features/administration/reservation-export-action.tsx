import { Suspense } from "react";
import { AdministrationActionLoading } from "./loading";
import {
  type AdministrationReservationExportInput,
  getAdministrationReservationExportHref,
} from "./reservation-export";
import { AdministrationTableExportAction } from "./table-toolbar";

const exportLabel = "Export CSV";

/**
 * The reservations-page export action. Both the streamed and static page
 * variants render this shared component so the download href always carries
 * the applied filters and never a page parameter.
 */
export function AdministrationReservationExportAction({
  input,
}: {
  readonly input: AdministrationReservationExportInput;
}) {
  return (
    <AdministrationTableExportAction
      href={getAdministrationReservationExportHref(input)}
      label={exportLabel}
    />
  );
}

export function AdministrationStreamedReservationExportAction({
  input,
}: {
  readonly input: Promise<AdministrationReservationExportInput>;
}) {
  return (
    <Suspense fallback={<AdministrationActionLoading label="export" />}>
      <StreamedExportAction input={input} />
    </Suspense>
  );
}

async function StreamedExportAction({
  input,
}: {
  readonly input: Promise<AdministrationReservationExportInput>;
}) {
  return <AdministrationReservationExportAction input={await input} />;
}

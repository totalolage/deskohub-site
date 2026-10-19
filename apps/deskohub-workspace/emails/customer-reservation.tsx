import { Column, Img, Row, Section, Text } from "react-email";
import {
  ReservationEmailActionPanel,
  type ReservationEmailLocation,
  ReservationEmailLocationPanel,
  type ReservationEmailTable,
} from "./_components/reservation-email-sections";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailLabel,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { customerReservationPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

// Table-map rendering is intentionally omitted. The removed legacy fulfillment
// renderer generated a table-map PNG attachment; that flow must be ported into
// this React Email template before table maps can be enabled again.
export type CustomerReservationEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly access: {
    readonly button: string;
    readonly url: string;
  };
  readonly invoice: {
    readonly label: string;
    readonly download: string;
    readonly url: string;
  };
  readonly labels: {
    readonly location: string;
    readonly directions: string;
    readonly table: string;
    readonly tables: string;
    readonly network: string;
    readonly networkName: string;
    readonly networkPassword: string;
  };
  readonly location: ReservationEmailLocation;
  readonly table?: ReservationEmailTable;
  readonly network?: {
    readonly ssid: string;
    readonly password: string;
    readonly qrImageSrc?: string;
  };
  readonly details: readonly WorkspaceEmailDetail[];
  readonly followUp: string;
};

export function CustomerReservationEmail({
  locale,
  preview,
  heading,
  access,
  invoice,
  labels,
  location,
  table,
  network,
  details,
  followUp,
}: CustomerReservationEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>

      <ReservationEmailActionPanel
        action={access}
        labels={labels}
        {...(table && { table })}
      />
      <ReservationEmailLocationPanel labels={labels} location={location} />

      {network && (
        <Section className="mt-6 rounded-2xl border border-[#cfe6f8] bg-sky px-5 py-5">
          <Row>
            <Column className="block w-full align-middle sm:table-cell sm:w-auto">
              <WorkspaceEmailLabel>{labels.network}</WorkspaceEmailLabel>
              <Text className="m-0 mt-3 text-[14px] leading-[22px] text-navy">
                <strong>{labels.networkName}:</strong>
                <br />
                {network.ssid}
              </Text>
              <Text className="m-0 mt-2 text-[14px] leading-[22px] text-navy">
                <strong>{labels.networkPassword}:</strong>
                <br />
                {network.password}
              </Text>
            </Column>
            {network.qrImageSrc && (
              <Column className="block w-full pt-4 text-center align-middle sm:table-cell sm:w-[168px] sm:pt-0 sm:pl-5 sm:text-right">
                <Img
                  alt={labels.network}
                  className="mx-auto block h-auto rounded-xl border border-[#d8edf8] bg-white p-2 sm:mr-0 sm:ml-auto"
                  src={network.qrImageSrc}
                  width="144"
                />
              </Column>
            )}
          </Row>
        </Section>
      )}

      <WorkspaceEmailDetails
        details={[
          ...details,
          {
            href: invoice.url,
            label: invoice.label,
            value: invoice.download,
          },
        ]}
      />
      <WorkspaceEmailNote>{followUp}</WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

CustomerReservationEmail.PreviewProps = customerReservationPreviewProps;

export default CustomerReservationEmail;

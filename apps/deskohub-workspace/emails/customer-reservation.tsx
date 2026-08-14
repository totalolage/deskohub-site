import { Column, Img, Link, Row, Section, Text } from "react-email";
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
    readonly network: string;
    readonly networkName: string;
    readonly networkPassword: string;
  };
  readonly location: {
    readonly address: string;
    readonly directionsUrl: string;
    readonly mapImageSrc?: string;
  };
  readonly table?: {
    readonly name: string;
  };
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

      <Section className="mt-6 overflow-hidden rounded-[22px] border border-[#d8d9e4]">
        <Section
          bgcolor="#00024f"
          className="bg-navy px-4 py-6 text-center sm:px-6"
          style={{ backgroundColor: "#00024f" }}
        >
          <Link
            className="inline-block rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
            href={access.url}
            style={{ backgroundColor: "#00df99", color: "#00024f" }}
          >
            {access.button}
          </Link>
        </Section>
        {table && (
          <Section className="border-t-4 border-aquamarine bg-[#e9fff6] px-5 py-5 text-center">
            <WorkspaceEmailLabel>{labels.table}</WorkspaceEmailLabel>
            <Text className="m-0 mt-1 text-[48px] font-bold leading-[54px] text-navy">
              {table.name}
            </Text>
          </Section>
        )}
      </Section>

      <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6ded2] bg-cream">
        <Section className="px-5 py-4">
          <WorkspaceEmailLabel>{labels.location}</WorkspaceEmailLabel>
          <Link
            className="mt-2 inline-block text-[17px] font-bold leading-[25px] text-navy no-underline"
            href={location.directionsUrl}
          >
            {location.address}
          </Link>
        </Section>
        {location.mapImageSrc && (
          <Img
            alt={labels.location}
            className="block h-auto w-full"
            src={location.mapImageSrc}
            width="534"
          />
        )}
        <Section className="px-5 py-5 text-center">
          <Link
            className="inline-block rounded-full bg-navy px-7 py-3 text-[14px] font-bold leading-[20px] text-white no-underline"
            href={location.directionsUrl}
          >
            {labels.directions}
          </Link>
        </Section>
      </Section>

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

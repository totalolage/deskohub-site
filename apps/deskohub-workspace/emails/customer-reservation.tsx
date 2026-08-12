import { Column, Heading, Img, Link, Row, Section, Text } from "react-email";
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
  readonly accessCode: string;
  readonly labels: {
    readonly accessCode: string;
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
  readonly shop: {
    readonly heading: string;
    readonly body: string;
    readonly action: string;
    readonly url: string;
  };
  readonly followUp: string;
};

export function CustomerReservationEmail({
  locale,
  preview,
  heading,
  accessCode,
  labels,
  location,
  table,
  network,
  details,
  shop,
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
          <WorkspaceEmailLabel inverse>{labels.accessCode}</WorkspaceEmailLabel>
          <Text
            className="m-0 mt-2 text-[50px] font-bold leading-[56px] tracking-[4px] text-white sm:text-[58px] sm:leading-[64px] sm:tracking-[6px]"
            style={{ color: "#ffffff" }}
          >
            {accessCode}
          </Text>
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
            <Column className="block w-full align-middle sm:table-cell">
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

      <Section className="mt-6 rounded-2xl border border-[#b8ead8] bg-[#e9fff6] px-5 py-5 text-center">
        <Heading
          as="h2"
          className="m-0 text-[20px] font-bold leading-[28px] text-navy"
        >
          {shop.heading}
        </Heading>
        <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#565975]">
          {shop.body}
        </Text>
        <Link
          className="mt-4 inline-block rounded-full bg-navy px-7 py-3 text-[14px] font-bold leading-[20px] text-white no-underline"
          href={shop.url}
        >
          {shop.action}
        </Link>
      </Section>

      <WorkspaceEmailDetails details={details} />
      <WorkspaceEmailNote>{followUp}</WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

CustomerReservationEmail.PreviewProps = customerReservationPreviewProps;

export default CustomerReservationEmail;

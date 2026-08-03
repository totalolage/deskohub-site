import { Column, Heading, Img, Link, Row, Section, Text } from "react-email";
import {
  type WorkspaceEmailDetail,
  WorkspaceEmailDetails,
} from "./_components/workspace-email-details";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { customerReservationPreviewProps } from "./_fixtures/preview-props";

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
    readonly tableMapAlt: string;
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
    readonly mapImageSrc?: string;
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
  accessCode,
  labels,
  location,
  table,
  network,
  details,
  followUp,
}: CustomerReservationEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <Heading className="m-0 text-[30px] font-bold leading-[38px] text-navy">
        {heading}
      </Heading>

      <Section className="mt-6 overflow-hidden rounded-[22px] border border-[#d8d9e4]">
        <Section className="bg-navy px-6 py-6 text-center">
          <Text className="m-0 text-[12px] font-bold leading-[16px] tracking-[2.4px] text-aquamarine uppercase">
            {labels.accessCode}
          </Text>
          <Text className="m-0 mt-2 text-[58px] font-bold leading-[64px] tracking-[6px] text-white">
            {accessCode}
          </Text>
        </Section>
        {table && (
          <Section className="border-t-4 border-aquamarine bg-[#e9fff6] px-5 py-5 text-center">
            <Text className="m-0 text-[12px] font-bold leading-[16px] tracking-[2.2px] text-green uppercase">
              {labels.table}
            </Text>
            <Text className="m-0 mt-1 text-[48px] font-bold leading-[54px] text-navy">
              {table.name}
            </Text>
            {table.mapImageSrc && (
              <Img
                alt={labels.tableMapAlt}
                className="mt-4 h-auto w-full rounded-xl border border-[#d9e7df] bg-white"
                src={table.mapImageSrc}
                width="500"
              />
            )}
          </Section>
        )}
      </Section>

      <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6ded2] bg-cream">
        <Section className="px-5 py-4">
          <Text className="m-0 text-[12px] font-bold leading-[16px] tracking-[2px] text-green uppercase">
            {labels.location}
          </Text>
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
            <Column className="align-middle">
              <Text className="m-0 text-[12px] font-bold leading-[16px] tracking-[2px] text-green uppercase">
                {labels.network}
              </Text>
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
              <Column className="w-[168px] pl-5 text-right align-middle">
                <Img
                  alt={labels.network}
                  className="inline-block h-auto rounded-xl border border-[#d8edf8] bg-white p-2"
                  src={network.qrImageSrc}
                  width="144"
                />
              </Column>
            )}
          </Row>
        </Section>
      )}

      <WorkspaceEmailDetails details={details} />
      <Text className="m-0 mt-5 text-[14px] leading-[23px] text-[#565975]">
        {followUp}
      </Text>
    </WorkspaceEmailLayout>
  );
}

CustomerReservationEmail.PreviewProps = customerReservationPreviewProps;

export default CustomerReservationEmail;

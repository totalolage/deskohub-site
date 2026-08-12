import type { ReactNode } from "react";
import { Heading, Section, Text } from "react-email";

export function WorkspaceEmailHeading({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Heading className="m-0 text-[26px] font-bold leading-[34px] text-navy sm:text-[30px] sm:leading-[38px]">
      {children}
    </Heading>
  );
}

export function WorkspaceEmailBody({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
      {children}
    </Text>
  );
}

export function WorkspaceEmailNote({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Text className="m-0 mt-5 text-[14px] leading-[23px] text-[#565975]">
      {children}
    </Text>
  );
}

export function WorkspaceEmailPanel({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <Section className="mt-3 rounded-2xl bg-cream px-5 py-4">
      <Text className="m-0 text-[15px] leading-[24px] text-navy">
        {children}
      </Text>
    </Section>
  );
}

export function WorkspaceEmailLabel({
  children,
  inverse = false,
}: {
  readonly children: ReactNode;
  readonly inverse?: boolean;
}) {
  return (
    <Text
      className={
        inverse
          ? "m-0 text-[12px] font-bold leading-[16px] tracking-[2.4px] text-aquamarine uppercase"
          : "m-0 text-[12px] font-bold leading-[16px] tracking-[2px] text-green uppercase"
      }
      style={inverse ? { color: "#00df99" } : undefined}
    >
      {children}
    </Text>
  );
}

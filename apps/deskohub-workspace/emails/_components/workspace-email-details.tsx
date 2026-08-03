import { Column, Row, Section, Text } from "react-email";

export type WorkspaceEmailDetail = {
  readonly label: string;
  readonly value: string;
};

export function WorkspaceEmailDetails({
  details,
}: {
  readonly details: readonly WorkspaceEmailDetail[];
}) {
  return (
    <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6e9f3]">
      {details.map((detail, index) => (
        <Row
          key={`${detail.label}-${detail.value}`}
          style={{
            borderBottom:
              index === details.length - 1 ? undefined : "1px solid #e6e9f3",
          }}
        >
          <Column className="w-[36%] px-4 py-3 align-top">
            <Text className="m-0 text-[13px] font-bold leading-[20px] text-[#565975]">
              {detail.label}
            </Text>
          </Column>
          <Column className="px-4 py-3 align-top">
            <Text className="m-0 break-all text-[14px] leading-[20px] text-navy sm:break-words">
              {detail.value}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  pixelBasedPreset,
  Section,
  Tailwind,
  Text,
} from "react-email";

export type WorkspaceEmailLocale = "cs-CZ" | "en-US";

type WorkspaceEmailLayoutProps = {
  readonly children: ReactNode;
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
};

export function WorkspaceEmailLayout({
  children,
  locale,
  preview,
}: WorkspaceEmailLayoutProps) {
  return (
    <Html lang={locale}>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                aquamarine: "#00df99",
                cream: "#f4f1ea",
                green: "#006b55",
                navy: "#00024f",
                sky: "#eef8ff",
              },
            },
          },
        }}
      >
        <Head>
          <meta
            content="width=device-width, initial-scale=1.0"
            name="viewport"
          />
        </Head>
        <Preview>{preview}</Preview>
        <Body
          className="m-0 bg-cream px-2 py-4 text-navy sm:px-3 sm:py-8"
          style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          <Container className="mx-auto w-full max-w-[600px]">
            <Section className="rounded-t-[24px] bg-navy px-5 py-6 sm:px-8 sm:py-7">
              <Text className="m-0 text-[12px] font-bold leading-[16px] tracking-[2.6px] text-aquamarine uppercase">
                Deskohub
              </Text>
              <Text className="m-0 mt-1 text-[20px] font-bold leading-[26px] text-white">
                Workspace
              </Text>
            </Section>
            <Section className="rounded-b-[24px] border border-[#e6ded2] border-t-0 bg-white px-5 py-6 sm:px-8 sm:py-8">
              {children}
            </Section>
            <Text className="m-0 px-5 pt-5 text-center text-[12px] leading-[18px] text-[#666983]">
              Deskohub Workspace · Turnovská 430/10 · Praha 8
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

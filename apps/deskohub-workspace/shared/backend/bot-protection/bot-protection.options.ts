interface BotIdEnvironment {
  readonly e2eBypass: "HUMAN" | undefined;
  readonly vercelEnvironment: "development" | "preview" | "production";
}

export const getBotIdCheckOptionsForEnvironment = ({
  e2eBypass,
  vercelEnvironment,
}: BotIdEnvironment) =>
  vercelEnvironment !== "production" && e2eBypass === "HUMAN"
    ? {
        developmentOptions: {
          bypass: "HUMAN" as const,
          isDevelopment: true,
        },
      }
    : undefined;

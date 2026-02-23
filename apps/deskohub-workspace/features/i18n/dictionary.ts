export const workspaceLocales = ["en-US", "cs-CZ"] as const;

export const defaultWorkspaceLocale = workspaceLocales[0];

type WorkspaceLocale = (typeof workspaceLocales)[number];

const translations: Record<
  WorkspaceLocale,
  { title: string; description: string }
> = {
  "en-US": {
    title: "Deskohub Workspace",
    description: "A monorepo-ready workspace shell with Effect and i18n hooks.",
  },
  "cs-CZ": {
    title: "Deskohub Workspace",
    description: "Monorepo pripraveny zaklad s integraci Effect a i18n.",
  },
};

export const getWorkspaceCopy = (locale: string) => {
  const resolvedLocale = workspaceLocales.includes(locale as WorkspaceLocale)
    ? (locale as WorkspaceLocale)
    : defaultWorkspaceLocale;

  return translations[resolvedLocale];
};

import type { Locale } from "@/features/i18n";

export interface MarketingPreferencesFormCopy {
  readonly title: string;
  readonly description: string;
  readonly accountContext: string;
  readonly linkContext: string;
  readonly statusAbsent: string;
  readonly statusActive: string;
  readonly statusWithdrawn: string;
  readonly grantConfirmation: string;
  readonly withdrawConfirmation: string;
  readonly grantAction: string;
  readonly withdrawAction: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveError: string;
  readonly pendingDescription: string;
  readonly continueAction: string;
  readonly confirming: string;
  readonly confirmed: string;
  readonly confirmError: string;
  readonly clearAction: string;
  readonly clearing: string;
  readonly cleared: string;
  readonly clearError: string;
  readonly unavailableDescription: string;
  readonly unavailableNextStep: string;
  readonly unavailableSignInNextStep: string;
  readonly signInAction: string;
  readonly invalidLinkDescription: string;
  readonly invalidLinkNextStep: string;
}

export const marketingPreferencesFormCopy = {
  "en-US": {
    title: "Marketing communications preference",
    description:
      "Choose whether Deskohub may send you future marketing and community communications.",
    accountContext:
      "Managing the customer preference for this signed-in account.",
    linkContext:
      "Managing the customer preference with this dedicated marketing-preference link, not your signed-in account.",
    statusAbsent: "No marketing preference is saved yet.",
    statusActive: "Marketing communications are currently enabled.",
    statusWithdrawn: "Marketing communications are currently withdrawn.",
    grantConfirmation:
      "I confirm that I want to receive future marketing and community communications.",
    withdrawConfirmation:
      "I confirm that I want to withdraw from future marketing and community communications.",
    grantAction: "Allow marketing communications",
    withdrawAction: "Withdraw marketing communications",
    saving: "Saving preference…",
    saved: "Your marketing preference was saved.",
    saveError: "We could not save your marketing preference. Please try again.",
    pendingDescription:
      "Continue to verify this dedicated marketing-preference link before viewing or changing the customer preference.",
    continueAction: "Continue",
    confirming: "Continuing…",
    confirmed: "The dedicated marketing-preference link is ready.",
    confirmError:
      "We could not continue with the dedicated marketing-preference link. Please try again.",
    clearAction: "Clear dedicated marketing-preference link",
    clearing: "Clearing management…",
    cleared: "Dedicated marketing-preference link management was cleared.",
    clearError:
      "We could not clear the dedicated marketing-preference link. Please try again.",
    unavailableDescription:
      "We could not load a marketing preference for this page.",
    unavailableNextStep:
      "Use the dedicated marketing-preference link to manage a preference.",
    unavailableSignInNextStep:
      "Alternatively, sign in to manage a preference from your account.",
    signInAction: "Sign in",
    invalidLinkDescription:
      "This dedicated marketing-preference link is invalid or has expired.",
    invalidLinkNextStep:
      "No account preference was changed. This link cannot be used to manage a preference.",
  },
  "cs-CZ": {
    title: "Nastavení marketingových sdělení",
    description:
      "Zvolte, zda vám může Deskohub v budoucnu zasílat marketingová a komunitní sdělení.",
    accountContext:
      "Spravujete zákaznickou preferenci pro tento přihlášený účet.",
    linkContext:
      "Spravujete zákaznickou preferenci pomocí tohoto vyhrazeného odkazu pro marketingová sdělení, nikoli z přihlášeného účtu.",
    statusAbsent: "Marketingová preference zatím není uložená.",
    statusActive: "Marketingová sdělení jsou nyní povolená.",
    statusWithdrawn: "Zasílání marketingových sdělení je nyní odvolané.",
    grantConfirmation:
      "Potvrzuji, že chci dostávat budoucí marketingová a komunitní sdělení.",
    withdrawConfirmation:
      "Potvrzuji, že chci odvolat zasílání budoucích marketingových a komunitních sdělení.",
    grantAction: "Povolit marketingová sdělení",
    withdrawAction: "Odvolat marketingová sdělení",
    saving: "Ukládání preference…",
    saved: "Vaše marketingová preference byla uložena.",
    saveError:
      "Marketingovou preferenci se nepodařilo uložit. Zkuste to prosím znovu.",
    pendingDescription:
      "Pokračujte ověřením tohoto vyhrazeného odkazu pro marketingová sdělení, teprve potom bude možné zobrazit nebo změnit zákaznickou preferenci.",
    continueAction: "Pokračovat",
    confirming: "Pokračování…",
    confirmed: "Vyhrazený odkaz pro marketingová sdělení je připravený.",
    confirmError:
      "Vyhrazený odkaz pro marketingová sdělení se nepodařilo ověřit. Zkuste to prosím znovu.",
    clearAction: "Vymazat vyhrazený odkaz pro marketingová sdělení",
    clearing: "Mazání správy odkazu…",
    cleared:
      "Správa pomocí vyhrazeného odkazu pro marketingová sdělení byla vymazána.",
    clearError:
      "Vyhrazený odkaz pro marketingová sdělení se nepodařilo vymazat. Zkuste to prosím znovu.",
    unavailableDescription:
      "Marketingovou preferenci se pro tuto stránku nepodařilo načíst.",
    unavailableNextStep:
      "Použijte vyhrazený odkaz pro marketingová sdělení ke správě preference.",
    unavailableSignInNextStep:
      "Případně se přihlaste a spravujte preferenci ze svého účtu.",
    signInAction: "Přihlásit se",
    invalidLinkDescription:
      "Tento vyhrazený odkaz pro marketingová sdělení je neplatný nebo jeho platnost vypršela.",
    invalidLinkNextStep:
      "Preference účtu nebyla změněna. Tento odkaz nelze použít ke správě preference.",
  },
} satisfies Readonly<Record<Locale, MarketingPreferencesFormCopy>>;

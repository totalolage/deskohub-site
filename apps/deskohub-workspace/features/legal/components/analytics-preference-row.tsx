"use client";

import Interpolate from "@doist/react-interpolate";
import { useRef, useState } from "react";
import { getAnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import { visitorConsent } from "@/features/cookie-consent/visitor-consent";
import { type Locale, m } from "@/features/i18n";
import { saveAccountAnalyticsPreference } from "@/features/legal/actions";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import { getLegalDocumentPath } from "@/features/legal/legal-document-path";
import { GuardedLink } from "@/shared/components/guarded-link";
import { PreferenceRow } from "@/shared/components/ui/preference-row";
import { Switch } from "@/shared/components/ui/switch";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

const signedInAccount = () => {
  const identity = getAnalyticsAccountIdentity();
  return identity.status === "authenticated" ? identity.accountId : undefined;
};

const switchId = "account-analytics-preference";
const titleId = `${switchId}-title`;
const descriptionId = `${switchId}-description`;

type Feedback = "saved" | "error";

/**
 * The signed-in account's analytics preference, which applies to every
 * device the account signs in on. The switch is optimistic: it moves on
 * toggle and returns to the last saved value when the save fails. A saved
 * choice is applied to this device's consent cookie at once, dated at the
 * account's decision. While the preference can't be read there is no
 * switch, so it never reads as off.
 */
export function AnalyticsPreferenceRow({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: Exclude<AnalyticsPreferenceState, { status: "signed-out" }>;
}) {
  const serverGranted = state.status === "available" && state.granted;
  const [checked, setChecked] = useState(serverGranted);
  // The last value the server confirmed; refreshed props may lag behind it.
  const [confirmedGranted, setConfirmedGranted] = useState(serverGranted);
  const [previousServerGranted, setPreviousServerGranted] =
    useState(serverGranted);
  if (serverGranted !== previousServerGranted) {
    setPreviousServerGranted(serverGranted);
    setChecked(serverGranted);
    setConfirmedGranted(serverGranted);
  }
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // This device's saved choice when the save was sent. A choice saved on the
  // device meanwhile, as with its own analytics switch, is newer than the
  // account's decision and leaves the device as it is, as does a session no
  // longer signed in to the account the decision was recorded for.
  const savedChoiceAtSend = useRef<string | null>(null);

  const fail = () => {
    setChecked(confirmedGranted);
    setFeedback("error");
  };

  const { executeAsync, isExecuting } = useWorkspaceAction(
    saveAccountAnalyticsPreference,
    {
      onSuccess: ({ data, input }) => {
        // Null when the session ended meanwhile: nothing was recorded.
        if (!data) return fail();
        if (
          savedChoiceAtSend.current === visitorConsent.saveMark() &&
          data.accountId === signedInAccount()
        ) {
          visitorConsent.applyAccountDecision({
            analytics: input.granted,
            decidedAt: data.decidedAt,
            change: "preference",
          });
        }
        setConfirmedGranted(input.granted);
        setFeedback("saved");
      },
      onError: ({ error }) => {
        // A transport failure is handled once, by onTransportError.
        if (error.thrownError !== undefined) return;
        fail();
      },
      onTransportError: fail,
    }
  );

  const inFlight = useRef(false);
  const release = () => {
    inFlight.current = false;
  };

  const handleToggle = (nextChecked: boolean) => {
    if (isExecuting || inFlight.current || nextChecked === checked) return;
    inFlight.current = true;
    savedChoiceAtSend.current = visitorConsent.saveMark();
    setFeedback(null);
    setChecked(nextChecked);
    void executeAsync({ granted: nextChecked }).then(release, release);
  };

  return (
    <PreferenceRow
      busy={isExecuting}
      control={
        state.status === "available" && (
          <Switch
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            checked={checked}
            className="shrink-0"
            disabled={isExecuting}
            id={switchId}
            onCheckedChange={handleToggle}
          />
        )
      }
      data-analytics-preference={state.status}
      description={
        <Interpolate
          string={m.analyticsPreferenceDescription({}, { locale })}
          mapping={{
            privacy: (label) => (
              <GuardedLink
                className="text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
                href={getLegalDocumentPath(locale, "privacy-policy")}
                prefetch={false}
              >
                {label}
              </GuardedLink>
            ),
          }}
        />
      }
      descriptionId={descriptionId}
      headingAs="h3"
      title={m.analyticsPreferenceTitle({}, { locale })}
      titleId={titleId}
    >
      <div className="text-sm">
        <div aria-live="polite" role="status">
          {state.status === "unavailable" && (
            <p>{m.analyticsPreferenceUnavailable({}, { locale })}</p>
          )}
          {isExecuting && <p>{m.analyticsPreferenceSaving({}, { locale })}</p>}
          {feedback === "saved" && (
            <p className="text-emerald-800">
              {m.analyticsPreferenceSaved({}, { locale })}
            </p>
          )}
        </div>
        <div role="alert">
          {feedback === "error" && (
            <p className="text-red-700">
              {m.analyticsPreferenceSaveError({}, { locale })}
            </p>
          )}
        </div>
      </div>
    </PreferenceRow>
  );
}

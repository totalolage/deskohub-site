import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BodyText } from "./controls";
import { ScrollScreen } from "./scroll-screen";

/** Stands in for an account screen that isn't built yet. */
export function PlaceholderScreen() {
  const locale = useAppLocale();
  return (
    <ScrollScreen>
      <BodyText>{m.account_placeholder({}, { locale })}</BodyText>
    </ScrollScreen>
  );
}

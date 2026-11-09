import type { CustomerAvatarPresentation } from "@deskohub/workspace-customer-api";
import { useAtom } from "@effect/atom-react";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useAppLocale } from "../../../i18n/locale-context";
import { m } from "../../../i18n/messages";
import { theme } from "../../../theme";
import { ConfirmDialog } from "../../../ui/confirm-dialog";
import { Button } from "../../../ui/controls";
import { Notice } from "../../../ui/notice";
import { Text } from "../../../ui/text";
import {
  avatarActionAtom,
  avatarFeedback,
  isAvatarBusy,
} from "./avatar-action";
import { avatarFeedbackNotice } from "./avatar-feedback-presentation";

const avatarSize = 72;

/**
 * The account's profile photo, or its initials, with controls to change or
 * remove it. Renders nothing while the release withholds avatars, including
 * once the Workspace answers that it does.
 */
export function AvatarSection({
  avatar,
  initials,
}: {
  readonly avatar: CustomerAvatarPresentation;
  readonly initials: string;
}) {
  const locale = useAppLocale();
  const [result, run] = useAtom(avatarActionAtom, { mode: "promiseExit" });
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const feedback = avatarFeedback(result);
  const busy = isAvatarBusy(feedback);
  const notice = avatarFeedbackNotice(feedback, locale);

  if (avatar.kind === "hidden" || feedback._tag === "Withheld") return null;
  const image = avatar.avatar;

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        {image === null ? (
          <View
            role="img"
            aria-label={m.profile_avatar_initials_label({}, { locale })}
            style={[styles.avatar, styles.initials]}
          >
            <Text aria-hidden style={styles.initialsText}>
              {initials}
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: image.url }}
            alt={m.profile_avatar_image_label({}, { locale })}
            style={styles.avatar}
          />
        )}
        <View style={styles.controls}>
          <Button
            label={
              image === null
                ? m.profile_avatar_add({}, { locale })
                : m.profile_avatar_change({}, { locale })
            }
            onPress={() => void run("change")}
            disabled={busy}
            variant="secondary"
          />
          {image !== null && (
            <Button
              label={m.profile_avatar_remove({}, { locale })}
              onPress={() => setConfirmingRemoval(true)}
              disabled={busy}
              variant="secondary"
            />
          )}
        </View>
      </View>
      <Text style={styles.hint}>{m.profile_avatar_hint({}, { locale })}</Text>
      <Notice tone={notice.tone} message={notice.message} />
      <ConfirmDialog
        visible={confirmingRemoval}
        title={m.profile_avatar_remove_title({}, { locale })}
        body={m.profile_avatar_remove_body({}, { locale })}
        confirmLabel={m.profile_avatar_remove({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        destructive
        busy={feedback._tag === "Removing"}
        busyMessage={m.profile_avatar_removing({}, { locale })}
        onConfirm={() =>
          void run("remove").then(() => setConfirmingRemoval(false))
        }
        onCancel={() => setConfirmingRemoval(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing.sm + theme.spacing.xs },
  row: { alignItems: "center", flexDirection: "row", gap: theme.spacing.md },
  avatar: {
    borderColor: theme.colors.border,
    borderRadius: avatarSize / 2,
    borderWidth: 1,
    height: avatarSize,
    width: avatarSize,
  },
  initials: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    justifyContent: "center",
  },
  initialsText: { color: theme.colors.text, ...theme.type.heading },
  controls: { flex: 1, gap: theme.spacing.sm },
  hint: { color: theme.colors.textMuted, ...theme.type.caption },
});

/**
 * Whether the platform's screen reader announces `aria-live` changes by
 * itself: TalkBack and browsers do, VoiceOver on iOS doesn't.
 */
export const announcesLiveRegions = (os: string) => os !== "ios";

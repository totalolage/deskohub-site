/**
 * Native requests can't pass BotID, so the app never sends the screened
 * requests itself: its email sign-in runs on the web page in an auth session.
 */
export const initializeBotProtection = (): void => undefined;

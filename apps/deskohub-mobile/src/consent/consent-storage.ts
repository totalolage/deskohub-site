import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ConsentStorage } from "./analytics-consent";
import {
  consentRecordKey,
  parseConsentRecord,
  serializeConsentRecord,
} from "./consent-record";

/** Native consent storage: one AsyncStorage record owned by the app. */
export const consentStorage = {
  read: async () =>
    parseConsentRecord(await AsyncStorage.getItem(consentRecordKey)),
  write: (categories) =>
    AsyncStorage.setItem(
      consentRecordKey,
      serializeConsentRecord(categories, new Date())
    ),
} satisfies ConsentStorage;

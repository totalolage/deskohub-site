/**
 * Metro bundles `reauthentication.native.ts` or `reauthentication.web.ts`;
 * this file only gives TypeScript the shared exports.
 */
export {
  isReauthenticationRequired,
  type Reauthentication,
  type ReauthenticationOutcome,
  useReauthentication,
} from "./reauthentication.native";

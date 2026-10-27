import { Effect } from "effect";
import type { AccountSection } from "@/features/account/sections";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import { browserSessionFor, type Runner } from "../runtime";
import { selectAccountSectionInSession } from "./account-sections";

/**
 * The account lane's browser steps that drive its session directly, while
 * the rest of each case still reaches the same context through argv
 * commands.
 */
export type WorkspaceE2EAccountLaneBrowser = {
  /** Selects the section in the lane page's account navigation. */
  readonly selectSection: (
    section: AccountSection
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the lane browser remembers exactly this shared code. */
  readonly waitForRememberedReferralCode: (
    code: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Waits until the lane browser remembers no referral code. */
  readonly waitForNoRememberedReferralCode: Effect.Effect<
    void,
    WorkspaceE2EError
  >;
};

/**
 * Reaches the session behind `run`'s `session` id on every call, so a failure
 * to open it fails the calling step.
 */
export const makeWorkspaceE2EAccountLaneBrowser = ({
  config,
  run,
  session,
}: {
  readonly config: Pick<WorkspaceE2EConfig, "baseUrl" | "timeouts">;
  readonly run: Runner;
  readonly session: string;
}): WorkspaceE2EAccountLaneBrowser => {
  const withSession = <A>(
    drive: (
      laneSession: E2EBrowserSession
    ) => Effect.Effect<A, WorkspaceE2EError>
  ) =>
    Effect.flatMap(
      Effect.suspend(() => browserSessionFor(run, session)),
      drive
    );
  return {
    selectSection: (section) =>
      withSession((laneSession) =>
        selectAccountSectionInSession(laneSession, section)
      ),
    waitForNoRememberedReferralCode: withSession((laneSession) =>
      waitForNoRememberedReferralCode({ config, session: laneSession })
    ),
    waitForRememberedReferralCode: (code) =>
      withSession((laneSession) =>
        waitForRememberedReferralCode({ config, session: laneSession }, code)
      ),
  };
};

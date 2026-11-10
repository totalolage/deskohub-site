/** Event property values stay scalar, like the site's server events. */
export type AnalyticsProperties = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * The analytics SDK calls the app makes. `posthog-client.ts` adapts
 * posthog-react-native; tests use a fake.
 */
export interface AnalyticsClient {
  /** Resolves once the client has loaded its stored state. */
  readonly ready: () => Promise<void>;
  /** After `ready`, the distinct ID the stored SDK identity is identified as, or `null` while anonymous. */
  readonly identifiedAs: () => string | null;
  readonly capture: (event: string, properties?: AnalyticsProperties) => void;
  readonly screen: (name: string) => void;
  readonly identify: (distinctId: string) => void;
  readonly setPersonProperties: (properties: AnalyticsProperties) => void;
  readonly reset: () => void;
  /**
   * Requests flags for the client's current identity. Resolves once a
   * response requested after this call is stored; rejects when it fails.
   */
  readonly reloadFeatureFlags: () => Promise<void>;
  /** A flag's value, or `undefined` until flags have loaded. */
  readonly getFeatureFlag: (flag: string) => boolean | string | undefined;
  /**
   * Pauses (`true`) or resumes every request the client sends, its own
   * flushes included. Queued events wait in its queue meanwhile; resuming
   * sends them.
   */
  readonly holdNetwork: (held: boolean) => void;
  /** Calls the listener whenever flags load. Returns the unsubscribe function. */
  readonly onFeatureFlags: (listener: () => void) => () => void;
  /**
   * Stops all delivery for good, at once even while the client is still
   * loading: opts out, drops queued events and stored identity, and detaches
   * timers. The client is unusable afterwards.
   */
  readonly shutDown: () => Promise<void>;
}

export interface AnalyticsClientOptions {
  readonly apiKey: string;
  readonly host: string;
  /**
   * Whether the client may request flags from PostHog. Only production does:
   * other builds share production's project and its flag-request quota.
   */
  readonly remoteFeatureFlags: boolean;
  /** Properties sent with every event the client captures. */
  readonly superProperties: AnalyticsProperties;
}

export type CreateAnalyticsClient = (
  options: AnalyticsClientOptions
) => AnalyticsClient;

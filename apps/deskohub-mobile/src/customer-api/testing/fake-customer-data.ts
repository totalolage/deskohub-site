import { Effect, Layer, Option } from "effect";
import { AccountReadBudget } from "../account-read-budget";
import {
  AccountExitFence,
  type AccountSession,
  accountDeviceLayer,
  makeAccountExitFence,
} from "../account-scoped-storage";
import {
  CustomerAccountScope,
  CustomerApi,
  CustomerAuthApi,
  CustomerSessionCheck,
} from "../customer-api.service";
import type { CustomerDataServices } from "../customer-data-runtime";
import {
  Clipboard,
  type DeviceCapabilities,
  DeviceStorage,
  ImageLibrary,
  type PickedImage,
  ShareSheet,
  TemporaryFiles,
} from "../device-capabilities";
import { nativeCustomerApiTransport } from "../platform-transports";
import {
  type FakeWorkspace,
  fakeWorkspaceHttpClient,
  fakeWorkspaceOrigin,
} from "./fake-workspace";

/** What the fake device capabilities recorded, for assertions. */
export interface FakeDevice {
  readonly storage: Map<string, string>;
  readonly files: Map<string, Uint8Array>;
  readonly sharedFiles: Array<{
    readonly uri: string;
    readonly name: string;
    readonly mimeType: string;
  }>;
  readonly sharedLinks: Array<{
    readonly url: string;
    readonly message?: string;
  }>;
  readonly copied: Array<{
    readonly text: string;
    readonly sensitive: boolean;
  }>;
  /** What the next image pick answers; none means the customer cancelled. */
  pickedImage: Option.Option<PickedImage>;
  /** How often the data layer asked to re-check the session. */
  sessionChecks: number;
}

export const makeFakeDevice = (): FakeDevice => ({
  storage: new Map(),
  files: new Map(),
  sharedFiles: [],
  sharedLinks: [],
  copied: [],
  pickedImage: Option.none(),
  sessionChecks: 0,
});

const fakeShareDirectory = "file:///cache/deskohub-share";
// Each write gets a folder of its own, as on the device, across every fake
// layer over one device.
let fakeFilesWritten = 0;

/** In-memory device capabilities that record what the app did. */
export const fakeDeviceCapabilities = (
  device: FakeDevice
): Layer.Layer<DeviceCapabilities> =>
  Layer.mergeAll(
    Layer.succeed(DeviceStorage, {
      getItem: (key) =>
        Effect.sync(() => Option.fromNullishOr(device.storage.get(key))),
      setItem: (key, value) =>
        Effect.sync(() => {
          device.storage.set(key, value);
        }),
      removeItems: (keys) =>
        Effect.sync(() => {
          for (const key of keys) device.storage.delete(key);
        }),
      keys: Effect.sync(() => [...device.storage.keys()]),
    }),
    Layer.succeed(TemporaryFiles, {
      write: (owner, name, bytes) =>
        Effect.sync(() => {
          fakeFilesWritten += 1;
          const uri = `${fakeShareDirectory}/${encodeURIComponent(owner)}/${fakeFilesWritten}/${name}`;
          device.files.set(uri, bytes);
          return uri;
        }),
      remove: (uri) =>
        Effect.sync(() => {
          device.files.delete(uri);
        }),
      sweep: (owner) =>
        Effect.sync(() => {
          const prefix = Option.match(owner, {
            onNone: () => `${fakeShareDirectory}/`,
            onSome: (id) => `${fakeShareDirectory}/${encodeURIComponent(id)}/`,
          });
          for (const uri of [...device.files.keys()]) {
            if (uri.startsWith(prefix)) device.files.delete(uri);
          }
        }),
    }),
    Layer.succeed(ShareSheet, {
      shareFile: (file) =>
        Effect.sync(() => {
          device.sharedFiles.push(file);
        }),
      shareLink: (link) =>
        Effect.sync(() => {
          device.sharedLinks.push(link);
        }),
    }),
    Layer.succeed(Clipboard, {
      copy: (text, { sensitive }) =>
        Effect.sync(() => {
          device.copied.push({ text, sensitive });
        }),
    }),
    Layer.succeed(ImageLibrary, {
      pickImage: Effect.sync(() => device.pickedImage),
    })
  );

/**
 * The real customer API clients and native transport over the fake
 * Workspace: requests carry the header, cookie and retry policy the app
 * really sends.
 */
export const fakeCustomerApiLayer = (
  workspace: FakeWorkspace
): Layer.Layer<CustomerApi | CustomerAuthApi> =>
  Layer.mergeAll(CustomerApi.Default, CustomerAuthApi.Default).pipe(
    Layer.provide(
      nativeCustomerApiTransport({
        apiOrigin: fakeWorkspaceOrigin,
        readSessionCookie: Effect.succeed("deskohub.session_token=sample"),
      })
    ),
    Layer.provide(fakeWorkspaceHttpClient(workspace))
  );

/**
 * Everything the data runtime provides, faked: the API over `workspace` and
 * device capabilities recording into `device`. Seed a registry with it to
 * test a view model (see `customer-data-test-registry.ts`).
 */
export const fakeCustomerDataLayer = ({
  workspace,
  device,
  fence = Layer.sync(AccountExitFence, makeAccountExitFence),
  session = {},
}: {
  readonly workspace: FakeWorkspace;
  readonly device: FakeDevice;
  /** Share one fence with an exit cleanup under test. */
  readonly fence?: Layer.Layer<AccountExitFence>;
  /** Another account or sign-in than the workspace's own, started at 0. */
  readonly session?: Partial<AccountSession>;
}): Layer.Layer<CustomerDataServices> =>
  Layer.mergeAll(
    fakeCustomerApiLayer(workspace),
    AccountReadBudget.Default,
    Layer.succeed(CustomerSessionCheck, {
      recheck: Effect.sync(() => {
        device.sessionChecks += 1;
      }),
    }),
    accountDeviceLayer(fakeDeviceCapabilities(device), fence).pipe(
      Layer.provideMerge(
        Layer.succeed(CustomerAccountScope, {
          accountId: workspace.data.accountId,
          apiOrigin: fakeWorkspaceOrigin,
          sessionStartedAt: 0,
          ...session,
        })
      )
    )
  );

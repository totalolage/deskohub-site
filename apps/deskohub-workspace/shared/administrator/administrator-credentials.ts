import { AdministrationActorUsername } from "@deskohub/workspace-admin-api";
import { Schema, SchemaGetter } from "effect";

const administratorUsernamePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const administratorCredentialDigestPattern = /^[0-9a-f]{64}$/;
const administratorCredentialEntryPattern =
  /^[a-z0-9][a-z0-9._-]{0,79}:[0-9a-f]{64}$/;

export const AdministratorCredentialDigest = Schema.String.check(
  Schema.isPattern(administratorCredentialDigestPattern, {
    message:
      "Administrator credential digests must be 64 lowercase hexadecimal characters.",
  })
)
  .pipe(Schema.brand("AdministratorCredentialDigest"))
  .annotate({
    identifier: "AdministratorCredentialDigest",
    description:
      "Lowercase SHA-256 hexadecimal digest of a Basic-auth credential.",
  });
export type AdministratorCredentialDigest =
  typeof AdministratorCredentialDigest.Type;

export const AdministratorUsername = AdministrationActorUsername.check(
  Schema.isPattern(administratorUsernamePattern, {
    message:
      "Administrator usernames must start with a lowercase letter or digit and contain only lowercase letters, digits, dots, underscores, and hyphens.",
  })
);

export const ConfiguredAdministratorCredential = Schema.Struct({
  username: AdministratorUsername,
  credentialDigest: AdministratorCredentialDigest,
}).annotate({
  identifier: "ConfiguredAdministratorCredential",
  description:
    "One administrator's Basic-auth username and its configured credential digest.",
});
export type ConfiguredAdministratorCredential =
  typeof ConfiguredAdministratorCredential.Type;

const configuredAdministratorCredentialEntries = Schema.Array(
  ConfiguredAdministratorCredential
).check(
  Schema.makeFilter((credentials) =>
    new Set(credentials.map(({ username }) => username)).size ===
    credentials.length
      ? undefined
      : "Administrator usernames must be unique."
  )
);

export type AdministratorCredentialRegistry =
  typeof configuredAdministratorCredentialEntries.Type;

type ConfiguredAdministratorCredentialEncoded =
  typeof ConfiguredAdministratorCredential.Encoded;

const decodeCredentialEntry = (
  entry: string
): ConfiguredAdministratorCredentialEncoded => {
  const separatorIndex = entry.indexOf(":");
  return {
    username: entry.slice(0, separatorIndex),
    credentialDigest: entry.slice(separatorIndex + 1),
  };
};

const decodeCredentialEntries = (raw: string) =>
  raw.split(/\r?\n/).map(decodeCredentialEntry);

const encodeCredentialEntries = (
  credentials: readonly ConfiguredAdministratorCredentialEncoded[]
) =>
  credentials
    .map(({ username, credentialDigest }) => `${username}:${credentialDigest}`)
    .join("\n");

export const administratorCredentialRegistrySchema = Schema.String.check(
  Schema.makeFilter((raw) =>
    raw
      .split(/\r?\n/)
      .every((entry) => administratorCredentialEntryPattern.test(entry))
      ? undefined
      : "Every line of the administrator credential registry must be a username followed by a colon and a lowercase SHA-256 digest, separated by newlines."
  )
).pipe(
  Schema.decodeTo(configuredAdministratorCredentialEntries, {
    decode: SchemaGetter.transform(decodeCredentialEntries),
    encode: SchemaGetter.transform(encodeCredentialEntries),
  })
);

export const isConfiguredAdministratorUsername = (
  registry: AdministratorCredentialRegistry,
  username: AdministrationActorUsername
) => registry.some((credential) => credential.username === username);

// Reads the package line of `aapt2 dump badging <apk>`:
//   package: name='cz.deskohub.workspace' versionCode='1000' versionName='0.1.0' ...
export type ApkIdentity = {
  readonly packageName: string;
  readonly versionCode: number;
  readonly versionName: string;
};

const attribute = (line: string, name: string): string | undefined =>
  new RegExp(`\\b${name}='([^']*)'`).exec(line)?.[1];

export const apkIdentity = (badging: string): ApkIdentity => {
  const line = badging
    .split("\n")
    .find((entry) => entry.startsWith("package:"));
  const packageName = line && attribute(line, "name");
  const versionCode = line && attribute(line, "versionCode");
  const versionName = line && attribute(line, "versionName");
  if (!(packageName && versionCode && versionName)) {
    throw new Error("aapt2 badging has no package name and version.");
  }
  return { packageName, versionCode: Number(versionCode), versionName };
};

export const verifyApkIdentity = (
  badging: string,
  expected: ApkIdentity
): ApkIdentity => {
  const actual = apkIdentity(badging);
  const mismatches = (Object.keys(expected) as (keyof ApkIdentity)[]).filter(
    (key) => actual[key] !== expected[key]
  );
  if (mismatches.length > 0) {
    throw new Error(
      `The APK has ${mismatches.map((key) => `${key} ${actual[key]}`).join(", ")}, expected ${mismatches.map((key) => `${key} ${expected[key]}`).join(", ")}.`
    );
  }
  return actual;
};

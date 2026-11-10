import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "./content";
import { getLegalDocumentVersion, hashLegalDocument } from "./document-version";
import type { LegalDocumentKey } from "./legal-document-summaries";

// Versions of the published documents. Stored consents and legal evidence
// record them, so a change here must come from an intended document change.
const publishedDocuments: ReadonlyArray<{
  readonly locale: Locale;
  readonly documentKey: LegalDocumentKey;
  readonly version: string;
}> = [
  {
    locale: "en-US",
    documentKey: "terms-and-conditions",
    version: "d56d9e83196b802aee01393512cff46d0fef6e01449c72b229db535b0bf095c6",
  },
  {
    locale: "en-US",
    documentKey: "operating-rules",
    version: "05cefdd98d32159cfce228b230931f9cc257643d90f83f327589732476c8ba56",
  },
  {
    locale: "en-US",
    documentKey: "privacy-policy",
    version: "53e796ba06229ee4d8e9500c3045178a27113df99b1d708dd59c11a3134fb7e5",
  },
  {
    locale: "en-US",
    documentKey: "marketing-communications",
    version: "3aa139f0b2a187e4d7bd7e488174b03c8e43b4a893d221b8527ed8e58db31653",
  },
  {
    locale: "en-US",
    documentKey: "cookie-policy",
    version: "476c15e027bde0e04823024f02842b5652456a9721680f0efd0dabf9d494fd03",
  },
  {
    locale: "cs-CZ",
    documentKey: "terms-and-conditions",
    version: "efa8ecfc37e738c1602de72de081f71cb97ca2ba8b194db9f4938071353b86dd",
  },
  {
    locale: "cs-CZ",
    documentKey: "operating-rules",
    version: "72c29525579c9f6bf1628e409da40b9bd6f620acfa9f2623198f7bbc73f4df77",
  },
  {
    locale: "cs-CZ",
    documentKey: "privacy-policy",
    version: "8a2a8f97a98f550859993a6c0884422796d86310d054b85198c2cea5aaaf7597",
  },
  {
    locale: "cs-CZ",
    documentKey: "marketing-communications",
    version: "3bbaa65156c221b8bf97b74a93c11830fb4f73cbbcd5d144932c51d6b71b4cb7",
  },
  {
    locale: "cs-CZ",
    documentKey: "cookie-policy",
    version: "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
  {
    locale: "de-DE",
    documentKey: "terms-and-conditions",
    version: "564032be01ea845e90a103867e89fd0e7d30186404d4fb0447d09c35c8aceef1",
  },
  {
    locale: "de-DE",
    documentKey: "operating-rules",
    version: "c62cfb615edfabaa1b46c687d360da01b0f84642e5870b80a79bbef152ec5b3c",
  },
  {
    locale: "de-DE",
    documentKey: "privacy-policy",
    version: "d219cb484f33adc57361b289f7f4c009420caef00b51894d73aff55af2c85c0f",
  },
  {
    locale: "de-DE",
    documentKey: "marketing-communications",
    version: "7682c568e3afca420f22c7476bfe1d14eab76fdd668e40f39ef1906c02a1bc77",
  },
  {
    locale: "de-DE",
    documentKey: "cookie-policy",
    version: "6812034325d23d8f848a4fb64f09d8aa014d62cc7d3addc45759c1fb075fc486",
  },
  {
    locale: "uk-UA",
    documentKey: "terms-and-conditions",
    version: "7b407b9397a1950a4d3a270140a435e9d1563b97a06b4e89ecfe482317f27ac2",
  },
  {
    locale: "uk-UA",
    documentKey: "operating-rules",
    version: "3b2c23e4556ddab5fb207e6ba78163c9d784def6d4c4cedf61362db353729687",
  },
  {
    locale: "uk-UA",
    documentKey: "privacy-policy",
    version: "f4fa60c6d8dff580e3cd048c64badeeb1f390344fc2f48d1fb90e5440e910daa",
  },
  {
    locale: "uk-UA",
    documentKey: "marketing-communications",
    version: "449dd97773156e2bcea5862a555c36aa61a1dd28965cf0c6ab567a148e8d82d4",
  },
  {
    locale: "uk-UA",
    documentKey: "cookie-policy",
    version: "08480393eeeadb3cbc83b2cdd9be368d03eb1f96a2156c4d5cf064ee7c656d00",
  },
  {
    locale: "sk-SK",
    documentKey: "terms-and-conditions",
    version: "1ae915a521a99a87d465a3c338880f31b13ec42ad2c0dae18259dcd411cc565a",
  },
  {
    locale: "sk-SK",
    documentKey: "operating-rules",
    version: "4bff1537e7e6a7903fecf5584178b37f52c9ef2d66076b4f2e55b057ca651852",
  },
  {
    locale: "sk-SK",
    documentKey: "privacy-policy",
    version: "7e12903683052ab508bbbb50228988cf06dacc872431f21506f8b6a4c8e5f3fb",
  },
  {
    locale: "sk-SK",
    documentKey: "marketing-communications",
    version: "ec36404d497d59aa8eb93b6ae808ac7106098459aadee5450e8c92153696c1aa",
  },
  {
    locale: "sk-SK",
    documentKey: "cookie-policy",
    version: "d9cc345892616de3c3b05e7e1f7e505a7947738423b2ee4276d0757f3d4dbfaf",
  },
  {
    locale: "vi-VN",
    documentKey: "terms-and-conditions",
    version: "ac564a4887b5794001b9e33c3e558365a8a6ef01cc0dbde792517a0fb222b090",
  },
  {
    locale: "vi-VN",
    documentKey: "operating-rules",
    version: "2bfa7e9a4afa15bcea55db7daa0737e64c79f395606737bd76bd64f0a740784f",
  },
  {
    locale: "vi-VN",
    documentKey: "privacy-policy",
    version: "89898a2e9b0b8ff9873d44e48c0d13c5dade1d79f91f9dc58de79bd46b918795",
  },
  {
    locale: "vi-VN",
    documentKey: "marketing-communications",
    version: "7a48ca1500301f44bc87fc89fa88b159386cc8e70ec04bf2374c9ea37c2adf44",
  },
  {
    locale: "vi-VN",
    documentKey: "cookie-policy",
    version: "d1a469bc79c9be640a99e42a1266b825ad10e543c7895526567d9207c4f2dd92",
  },
  {
    locale: "hi-IN",
    documentKey: "terms-and-conditions",
    version: "e2e9d3c1ba9c4ea94164544416d35d3227a58adbbae9e5930478ccd02878e81c",
  },
  {
    locale: "hi-IN",
    documentKey: "operating-rules",
    version: "635da5bf566a299b094ae7f8fc86235f9f551361b10d505e0d27f021ea7fbd31",
  },
  {
    locale: "hi-IN",
    documentKey: "privacy-policy",
    version: "db35770c2e282d1d15ce49251eebfba87b6d75e6b2b7d838e4882c5c62960c13",
  },
  {
    locale: "hi-IN",
    documentKey: "marketing-communications",
    version: "358888b8c2d137d0ecc28ff406e2267ec833f12f641e18c9380d9620f3ca0882",
  },
  {
    locale: "hi-IN",
    documentKey: "cookie-policy",
    version: "8a1b1ac6543ec1b2a5d9ab7188e86679699a29fe1910e762bfa8a1a151ed6bad",
  },
];

describe("getLegalDocumentVersion", () => {
  test.each(publishedDocuments)(
    "versions $locale $documentKey by its content hash",
    ({ locale, documentKey, version }) => {
      expect(getLegalDocumentVersion(locale, documentKey)).toBe(version);
      expect(getLegalDocumentVersion(locale, documentKey)).toBe(version);
    }
  );
});

describe("hashLegalDocument", () => {
  test.each(publishedDocuments)(
    "hashes $locale $documentKey to its published version",
    ({ locale, documentKey, version }) => {
      expect(hashLegalDocument(getLegalDocument(locale, documentKey))).toBe(
        version
      );
    }
  );

  test("gives a changed document a new version", () => {
    const document = getLegalDocument("en-US", "marketing-communications");

    expect(
      hashLegalDocument({ ...document, updatedAt: `${document.updatedAt}.` })
    ).not.toBe(getLegalDocumentVersion("en-US", "marketing-communications"));
  });
});

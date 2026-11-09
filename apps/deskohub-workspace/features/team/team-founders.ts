import { CloudinaryPublicIdSchema } from "@deskohub/cloudinary/schema";
import { type Locale, m } from "@/features/i18n";

/**
 * The founders the team page introduces, in page order. A founder without a
 * name is shown censored.
 */
export const getTeamFounders = (locale: Locale) =>
  [
    {
      imagePublicId: CloudinaryPublicIdSchema.make("founder-profile-danica"),
      name: "Danica",
      role: m.landingFounderDanicaRole({}, { locale }),
      description: m.landingFounderDanicaDescription({}, { locale }),
    },
    {
      imagePublicId: CloudinaryPublicIdSchema.make("founder-profile-filip"),
      name: "Filip",
      role: m.landingFounderFilipRole({}, { locale }),
      description: m.landingFounderFilipDescription({}, { locale }),
    },
    {
      imagePublicId: CloudinaryPublicIdSchema.make("founder-profile-carp"),
      name: null,
      role: m.landingFounderHardwareRole({}, { locale }),
      description: m.landingFounderHardwareDescription({}, { locale }),
    },
  ] as const;

import type { UseFormReturn } from "react-hook-form";
import type {
  CampaignComposerFields,
  createCampaignComposerFields,
} from "./campaign-composer-fields";

type CampaignComposerSchema = ReturnType<typeof createCampaignComposerFields>;

/** The composer's form: encoded field values in, decoded fields on submit. */
export type CampaignComposerForm = UseFormReturn<
  CampaignComposerSchema["Encoded"],
  unknown,
  CampaignComposerFields
>;

/** The composer form's control, which its field components register with. */
export type CampaignComposerControl = CampaignComposerForm["control"];

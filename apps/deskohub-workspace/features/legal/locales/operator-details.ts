import { workspaceSiteConstants } from "@/shared/utils";

// The company the legal documents name, in the same words in every locale.
export const companyName = workspaceSiteConstants.brand.legalName;
export const contactEmail = workspaceSiteConstants.contact.infoEmail;
export const companyAddress = `${workspaceSiteConstants.location.address.street}, ${workspaceSiteConstants.location.address.postalCode} ${workspaceSiteConstants.location.address.city} - ${workspaceSiteConstants.location.address.cityDistrict}`;

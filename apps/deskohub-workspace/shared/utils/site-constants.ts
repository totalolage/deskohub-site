export const workspaceSiteConstants = {
  brand: {
    name: "Deskohub Workspace",
    legalName: "Deskohub s.r.o.",
    domain: "deskohub.cz",
  },
  contact: {
    phone: "+420777060478",
    get infoEmail() {
      return `workspace@${workspaceSiteConstants.brand.domain}`;
    },
    address: {
      street: "Turnovska 10/430",
      cityDistrict: "Palmovka",
      city: "Praha 8",
      postalCode: "180 00",
    },
  },
  social: {
    instagram: "https://www.instagram.com/deskohub/",
    facebook: "https://www.facebook.com/deskohub",
  },
} as const;

/**
 * The product's name and logo, in one place. To rebrand: change `name`, drop the logo
 * file into /public and set `logo`. Nothing else in the code needs to change.
 */
export const brand = {
  name: "Proof Engine",
  /** Path under /public, e.g. "/logo.svg" or "/logo.png". Null shows the name only. */
  logo: null as string | null,
  /** Accessible description of the logo image. */
  logoAlt: "",
};

/** Browser tab title: "Sign in | <name>". */
export const pageTitle = (page?: string) => (page ? `${page} | ${brand.name}` : brand.name);

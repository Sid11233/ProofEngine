// RFC 9116 security.txt: where to report a vulnerability. The contact comes from SECURITY_CONTACT, so the
// file is never published with a made-up address; until it is set the route answers 404.

export const SECURITY_CONTACT_PATTERN = /^(mailto:[^\s@<>]+@[^\s@<>]+|https:\/\/[^\s<>]+)$/;

export function securityTxt({ contact, appUrl, now = new Date(), policyUrl }: { contact: string; appUrl: string; now?: Date; policyUrl?: string }): string {
  // Valid for 180 days from the day it is served, as the RFC asks for a near-future expiry.
  const expires = new Date(now.getTime() + 180 * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  return [
    `Contact: ${contact}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${new URL("/.well-known/security.txt", appUrl).toString()}`,
    ...(policyUrl ? [`Policy: ${policyUrl}`] : []),
    "",
  ].join("\n");
}

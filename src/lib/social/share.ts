import { NETWORK_INFO, type Network } from "./networks";

/**
 * Where the "open" button for a draft goes. Only networks that pre-fill text from a link get
 * the text in the URL; the others open the profile (if the owner saved one) or the app's home.
 * The result is always an https URL on a known host, so it is safe for an anchor with
 * target="_blank" rel="noopener noreferrer".
 */
export function openUrl(network: Network, body: string, profileUrl?: string | null): string {
  const text = encodeURIComponent(body.slice(0, 2000));
  if (network === "x") return `https://x.com/intent/post?text=${text}`;
  if (network === "linkedin") return `https://www.linkedin.com/feed/?shareActive=true&text=${text}`;
  return safeProfileUrl(network, profileUrl) ?? NETWORK_INFO[network].home;
}

/** A profile link is used only if it is https and on one of the network's own hosts. */
export function safeProfileUrl(network: Network, value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const ok = NETWORK_INFO[network].hosts.some((h) => host === h || host.endsWith(`.${h}`));
    return url.protocol === "https:" && ok ? url.toString() : null;
  } catch {
    return null;
  }
}

export const NETWORKS = ["linkedin", "x", "facebook", "instagram", "tiktok"] as const;
export type Network = (typeof NETWORKS)[number];

export interface NetworkInfo {
  label: string;
  /** Longest post the network takes; the builder never exceeds it. */
  maxChars: number;
  /** One line of style guidance for the model. */
  style: string;
  /** Hosts a profile link for this network may use. */
  hosts: readonly string[];
  /** Where the "open" button goes when the network has no way to pre-fill a post. */
  home: string;
}

export const NETWORK_INFO: Record<Network, NetworkInfo> = {
  linkedin: {
    label: "LinkedIn",
    maxChars: 1500,
    style: "A professional LinkedIn post: a hook line, two or three short paragraphs about the problem and the result, then a closing line. At most 3 hashtags.",
    hosts: ["linkedin.com"],
    home: "https://www.linkedin.com/feed/",
  },
  x: {
    label: "X",
    maxChars: 270,
    style: "A single post of at most 270 characters. Direct, one idea, at most 2 hashtags.",
    hosts: ["x.com", "twitter.com"],
    home: "https://x.com/home",
  },
  facebook: {
    label: "Facebook",
    maxChars: 900,
    style: "A friendly Facebook page post of two or three short paragraphs. At most 2 hashtags.",
    hosts: ["facebook.com"],
    home: "https://www.facebook.com/",
  },
  instagram: {
    label: "Instagram",
    maxChars: 1200,
    style: "An Instagram caption: a short hook on the first line, a few short lines, then up to 5 hashtags on the last line.",
    hosts: ["instagram.com"],
    home: "https://www.instagram.com/",
  },
  tiktok: {
    label: "TikTok",
    maxChars: 700,
    style: "A TikTok: a one line caption and a short spoken script of 3 or 4 lines, labelled 'Caption:' and 'Script:'. At most 4 hashtags.",
    hosts: ["tiktok.com"],
    home: "https://www.tiktok.com/",
  },
};

export const VARIANTS_PER_NETWORK = 3;

export function isNetwork(value: string): value is Network {
  return (NETWORKS as readonly string[]).includes(value);
}

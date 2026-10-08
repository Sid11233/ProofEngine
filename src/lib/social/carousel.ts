import type { Network } from "./networks";

// Carousel shapes. Slides are short plain text; the picture is drawn in the browser from these fields, so nothing the
// model or the owner types can become markup or a link. Sizes are the platforms' usual carousel sizes.

export const SLIDE_KINDS = ["title", "point", "quote", "stat", "cta"] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export interface Slide {
  kind: SlideKind;
  heading: string;
  body: string;
}

export const MAX_SLIDES = 10;
export const MIN_SLIDES = 2;
export const MAX_HEADING = 80;
export const MAX_SLIDE_BODY = 240;

/** X has no carousel; the others do. */
export const CAROUSEL_NETWORKS: readonly Network[] = ["linkedin", "instagram", "facebook", "tiktok"];
export const supportsCarousel = (n: Network) => CAROUSEL_NETWORKS.includes(n);

export const SLIDE_SIZE: Record<Network, { width: number; height: number }> = {
  linkedin: { width: 1080, height: 1350 },
  instagram: { width: 1080, height: 1350 },
  facebook: { width: 1080, height: 1080 },
  tiktok: { width: 1080, height: 1920 },
  x: { width: 1200, height: 675 },
};

/** How the finished carousel is used on each network. */
export const CAROUSEL_HOWTO: Record<Network, string> = {
  linkedin: "Download the PDF and upload it to a LinkedIn post as a document.",
  instagram: "Download the pictures and add them to one Instagram post as a carousel, in order.",
  facebook: "Download the pictures and add them to one Facebook post as a multi-photo post, in order.",
  tiktok: "Download the pictures and make a TikTok photo post with them, in order.",
  x: "X does not have carousels.",
};

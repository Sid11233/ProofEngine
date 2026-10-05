import { Inter, Lora, Merriweather, Open_Sans, Playfair_Display, Poppins, Source_Sans_3, Space_Grotesk } from "next/font/google";
import type { FontPair } from "./theme";

// Six fixed font pairs loaded with next/font (self-hosted at build time: no request to
// Google when a page is viewed). The theme only ever names a pair from FONT_PAIRS.

const inter = Inter({ subsets: ["latin"], variable: "--font-cs-inter", display: "swap" });
const lora = Lora({ subsets: ["latin"], variable: "--font-cs-lora", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-cs-poppins", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-cs-space-grotesk", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-cs-playfair", display: "swap" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-cs-source-sans", display: "swap" });
const merriweather = Merriweather({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-cs-merriweather", display: "swap" });
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-cs-open-sans", display: "swap" });

const PAIRS: Record<FontPair, { heading: { variable: string }; body: { variable: string }; headingVar: string; bodyVar: string }> = {
  inter: { heading: inter, body: inter, headingVar: "--font-cs-inter", bodyVar: "--font-cs-inter" },
  "lora-inter": { heading: lora, body: inter, headingVar: "--font-cs-lora", bodyVar: "--font-cs-inter" },
  "poppins-inter": { heading: poppins, body: inter, headingVar: "--font-cs-poppins", bodyVar: "--font-cs-inter" },
  "space-grotesk-inter": { heading: spaceGrotesk, body: inter, headingVar: "--font-cs-space-grotesk", bodyVar: "--font-cs-inter" },
  "playfair-source": { heading: playfair, body: sourceSans, headingVar: "--font-cs-playfair", bodyVar: "--font-cs-source-sans" },
  "merriweather-opensans": { heading: merriweather, body: openSans, headingVar: "--font-cs-merriweather", bodyVar: "--font-cs-open-sans" },
};

/** Class names that define the pair's font variables, and the CSS variables that point at them. */
export function fontsFor(pair: FontPair): { className: string; vars: Record<string, string> } {
  const entry = PAIRS[pair];
  return {
    className: `${entry.heading.variable} ${entry.body.variable}`,
    vars: { "--cs-font-heading": `var(${entry.headingVar})`, "--cs-font-body": `var(${entry.bodyVar})` },
  };
}

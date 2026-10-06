import Image from "next/image";
import { brand } from "@/lib/brand";

/**
 * The wordmark for headers and auth screens: the dark-text logo on light backgrounds and the light-text one on
 * dark backgrounds (they swap with the colour scheme). The image carries the name, so it has the alt text.
 */
export function BrandMark({ className = "", height = 28 }: { className?: string; height?: number }) {
  const width = Math.round((brand.logo.width / brand.logo.height) * height);
  return (
    <span className={`inline-flex items-center ${className}`}>
      <Image src={brand.logo.light} alt={brand.logoAlt} width={width} height={height} unoptimized priority className="block dark:hidden" style={{ height, width }} />
      <Image src={brand.logo.dark} alt="" aria-hidden="true" width={width} height={height} unoptimized priority className="hidden dark:block" style={{ height, width }} />
    </span>
  );
}

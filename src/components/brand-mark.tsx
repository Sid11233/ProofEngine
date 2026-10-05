import Image from "next/image";
import { brand } from "@/lib/brand";

/** Logo (when configured) and name, for headers and auth screens. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      {brand.logo ? <Image src={brand.logo} alt={brand.logoAlt} width={28} height={28} unoptimized priority /> : null}
      <span>{brand.name}</span>
    </span>
  );
}

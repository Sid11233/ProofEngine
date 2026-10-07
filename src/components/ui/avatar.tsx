/* eslint-disable @next/next/no-img-element */
const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-12 text-base" } as const;

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

/** Initials on the orange tint, or a logo image. Decorative: the name is always next to it. */
export function Avatar({ name, src, size = "md", solid = false }: { name: string; src?: string | null; size?: keyof typeof SIZES; solid?: boolean }) {
  const look = solid ? "bg-foreground text-white" : "bg-tint text-[#b43a0c]";
  return src ? (
    <img src={src} alt="" aria-hidden="true" className={`${SIZES[size]} shrink-0 rounded-full object-cover`} />
  ) : (
    <span aria-hidden="true" className={`${SIZES[size]} ${look} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}>{initialsOf(name)}</span>
  );
}

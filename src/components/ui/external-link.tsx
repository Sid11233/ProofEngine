/** Owner-supplied links open in a new tab without a referrer or window handle. Only https addresses reach here (database constraint). */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">{children}</a>;
}

"use client";

import { useEffect, useRef } from "react";

type Declared = { turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => string } };

/** Cloudflare Turnstile bot check. The script is loaded with the page nonce (strict-dynamic CSP). */
export function TurnstileWidget({ siteKey, nonce, onToken }: { siteKey: string; nonce?: string; onToken: (token: string | undefined) => void }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const render = () => {
      const api = (window as unknown as Declared).turnstile;
      if (api && container.current && !container.current.hasChildNodes()) {
        api.render(container.current, {
          sitekey: siteKey,
          callback: (value: string) => onToken(value),
          "expired-callback": () => onToken(undefined),
          "error-callback": () => onToken(undefined),
        });
      }
    };
    if ((window as unknown as Declared).turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    if (nonce) script.nonce = nonce;
    script.onload = render;
    document.head.appendChild(script);
  }, [siteKey, nonce, onToken]);

  return <div ref={container} aria-label="Verification" />;
}

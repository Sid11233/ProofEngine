"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { MOTION_COOKIE, parsePreference, resolveReducedMotion, type MotionPreference } from "@/lib/motion/preference";

interface Value {
  preference: MotionPreference;
  setPreference: (next: MotionPreference) => void;
  /** True when animations should be reduced (system and in-app setting combined). */
  reduced: boolean;
}

const MotionContext = createContext<Value>({ preference: "system", setPreference: () => undefined, reduced: false });

/** App-shell only. Loads the motion features lazily and applies the in-app Reduce motion setting. */
export function MotionProvider({ initialPreference, children }: { initialPreference: MotionPreference; children: ReactNode }) {
  const [preference, setPreferenceState] = useState(initialPreference);
  const [system, setSystem] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystem(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const setPreference = useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    // A display preference, not a secret: a plain cookie so the server can render the right attribute without a flash.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${MOTION_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.dataset.motion = next;
  }, []);

  const value = useMemo<Value>(() => ({ preference, setPreference, reduced: resolveReducedMotion(system, preference) }), [preference, setPreference, system]);

  return (
    <MotionContext.Provider value={value}>
      {/* "always" turns transform animations off while keeping opacity; "never" lets an explicit "allow motion" win over the system. */}
      <MotionConfig reducedMotion={preference === "reduce" ? "always" : preference === "full" ? "never" : "user"}>
        <LazyMotion features={domMax} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </MotionContext.Provider>
  );
}

export const useMotionPreference = () => useContext(MotionContext);

export { parsePreference };

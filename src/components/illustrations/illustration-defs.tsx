// The two magnet shapes the illustrations reuse (<use href="#il-mag">), defined once per page.
export function IllustrationDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <symbol id="il-mag" viewBox="-45 -45 90 90">
        <path d="M-45 30 H0 a30 30 0 0 0 0 -60 H-45" fill="none" stroke="#FF5A1F" strokeWidth="30" />
        <rect x="-45" y="-45" width="18" height="30" fill="currentColor" />
        <rect x="-45" y="15" width="18" height="30" fill="currentColor" />
      </symbol>
      <symbol id="il-magup" viewBox="-45 -45 90 90">
        <path d="M-30 -45 V0 a30 30 0 0 0 60 0 V-45" fill="none" stroke="#FF5A1F" strokeWidth="30" />
        <rect x="-45" y="-45" width="30" height="18" fill="currentColor" />
        <rect x="15" y="-45" width="30" height="18" fill="currentColor" />
      </symbol>
    </svg>
  );
}

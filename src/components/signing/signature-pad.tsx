"use client";

import { useEffect, useRef, useState } from "react";

const WIDTH = 600;
const HEIGHT = 200;

/** A touch-friendly signature box. Gives back a small PNG data URL, or null while it is empty. */
export function SignaturePad({ onChange, disabled }: { onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111111";
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const ctx = event.currentTarget.getContext("2d");
    const { x, y } = point(event);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    ctx?.lineTo(x + 0.01, y);
    ctx?.stroke();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = event.currentTarget.getContext("2d");
    const { x, y } = point(event);
    ctx?.lineTo(x, y);
    ctx?.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvas.current?.toDataURL("image/png") ?? null);
  };
  const clear = () => {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Signature box: draw your signature with your finger or mouse"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="h-40 w-full touch-none rounded-md border border-neutral-400 bg-white"
      />
      <button type="button" onClick={clear} disabled={empty || disabled} className="inline-flex min-h-11 items-center rounded-md border border-neutral-400 px-4 text-sm disabled:opacity-50">Clear</button>
    </div>
  );
}

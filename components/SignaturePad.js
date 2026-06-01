"use client";

import { useEffect, useRef, useState } from "react";

// Lightweight, dependency-free signature pad. The user draws on a <canvas> with
// mouse / touch / pen; the result is emitted as a white-background PNG data URL
// via onChange (empty string once cleared). Sized for crisp lines on HiDPI.
export default function SignaturePad({ onChange, clearLabel = "Clear", hint }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const inked = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    // White background so the exported signature isn't transparent.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#13315c";
  }, []);

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    drawing.current = true;
    last.current = point(e);
    try {
      canvasRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture unsupported — fine */
    }
  }

  function onMove(e) {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked.current) {
      inked.current = true;
      setHasInk(true);
    }
  }

  function onUp() {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current) onChange(canvasRef.current.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    inked.current = false;
    setHasInk(false);
    onChange("");
  }

  return (
    <div className="sig-pad">
      <div className="sig-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="sig-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        {!hasInk && hint && <span className="sig-placeholder">{hint}</span>}
      </div>
      <div className="sig-toolbar">
        <span className={hasInk ? "sig-state signed" : "sig-state"}>
          {hasInk ? "✓" : ""}
        </span>
        <button type="button" className="btn-link sig-clear" onClick={clear}>
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

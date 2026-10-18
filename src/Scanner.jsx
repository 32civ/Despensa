import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

const camMessage = (e) => {
  if (!navigator.mediaDevices?.getUserMedia) return "La cámara solo funciona en páginas seguras (https).";
  if (e?.name === "NotAllowedError")
    return "Permiso de cámara denegado. En iPhone: toca «aA» en la barra de Safari → Ajustes del sitio web → Cámara → Permitir, y vuelve a abrir el escáner.";
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return "No se encontró una cámara en este dispositivo.";
  return "No se pudo iniciar la cámara. Puedes escribir el código a mano.";
};
const TONE = { added: "text-emerald-300", new: "text-amber-300", error: "text-red-300" };
const MARK = { added: "✓", new: "＋", error: "⚠" };
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";

export default function Scanner({ onCode, onClose, paused }) {
  const videoRef = useRef(null);
  const dialogRef = useRef(null);
  const seen = useRef({ code: "", t: 0 });
  const live = useRef({ paused, onCode });
  live.current = { paused, onCode };
  const [feed, setFeed] = useState([]);
  const [camError, setCamError] = useState("");
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);

  // Mientras el código siga a la vista no se repite; hay que apartarlo >1,5 s para volver a contarlo.
  const process = async (raw, force) => {
    if (live.current.paused) return;
    const now = Date.now();
    const same = seen.current.code === raw && now - seen.current.t < 1500;
    seen.current = { code: raw, t: now };
    if (same && !force) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    const res = await live.current.onCode(raw);
    setFeed((f) => [{ ...res, id: `${now}-${raw}` }, ...f].slice(0, 6));
  };

  // Al reanudar tras confirmar un producto, el código que sigue a la vista no debe contarse otra vez.
  useEffect(() => { if (!paused) seen.current.t = Date.now(); }, [paused]);

  useEffect(() => {
    const opener = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape" && !live.current.paused) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [onClose]);

  useEffect(() => {
    let controls;
    let stopped = false;
    const hints = new Map([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    try {
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      reader
        .decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result) => { if (result) process(result.getText()); }
        )
        .then((c) => { if (stopped) c.stop(); else controls = c; })
        .catch((e) => setCamError(camMessage(e)));
    } catch (e) {
      setCamError(camMessage(e));
    }
    return () => { stopped = true; controls?.stop(); };
  }, []);

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Escanear compras" tabIndex={-1}
         className="fixed inset-0 z-30 flex flex-col bg-black pt-[env(safe-area-inset-top)] text-white outline-none">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="font-semibold">Guardar compras</h2>
        <button onClick={onClose} className={`h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold ${focusRing}`}>Terminar</button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" className="h-full w-full object-cover" />
        {!camError && (
          <div aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-1/2 h-32 w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 transition-colors ${flash ? "border-emerald-400" : "border-white/80"}`} />
        )}
        {paused && <p className="absolute inset-x-4 top-4 rounded-xl bg-black/75 p-3 text-center text-sm">Completa el producto para seguir escaneando.</p>}
        {camError && <p role="alert" className="absolute inset-4 flex items-center justify-center rounded-2xl bg-stone-900 p-4 text-center text-sm">{camError}</p>}
      </div>

      <div className="space-y-3 bg-stone-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <ul role="log" aria-live="polite" className="max-h-32 space-y-1 overflow-y-auto text-sm">
          {feed.length === 0 && <li className="text-stone-400">Apunta la cámara al código de barras de cada producto. Cada lectura suma 1 unidad.</li>}
          {feed.map((f) => <li key={f.id} className={TONE[f.type]}><span aria-hidden="true">{MARK[f.type]} </span>{f.msg}</li>)}
        </ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { process(manual.trim(), true); setManual(""); } }}>
          <input name="codigo" inputMode="numeric" autoComplete="off" value={manual} onChange={(e) => setManual(e.target.value)}
            aria-label="Escribir código de barras" placeholder="O escribe el código…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-stone-600 bg-stone-800 px-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" />
          <button className={`h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold ${focusRing}`}>Agregar</button>
        </form>
      </div>
    </div>
  );
}

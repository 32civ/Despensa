import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

const nf = new Intl.NumberFormat("es", { maximumFractionDigits: 3 });
const round = (n) => Math.round(n * 1000) / 1000;
const LEVEL_UNIT = "nivel";
const LEVEL_TEXT = { 2: "Hay", 1: "Poco", 0: "Se acabó" };
const LEVEL_STYLE = {
  2: "border-emerald-600 bg-emerald-900/40",
  1: "border-amber-500 bg-amber-900/40",
  0: "border-red-500 bg-red-900/40",
};
// Pasos de ajuste según la unidad (kg y litros suben de a medio).
const stepsFor = (unit) => (unit === "kg" || unit === "litros" ? [-0.5, 0.5, 1, 2] : [-1, 1, 3, 6]);
const fmtDelta = (d) => `${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))}`;

const camMessage = (e) => {
  if (!navigator.mediaDevices?.getUserMedia) return "La cámara solo funciona en páginas seguras (https).";
  if (e?.name === "NotAllowedError")
    return "Permiso de cámara denegado. En iPhone: toca «aA» en la barra de Safari → Ajustes del sitio web → Cámara → Permitir, y vuelve a abrir el escáner.";
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return "No se encontró una cámara en este dispositivo.";
  return "No se pudo iniciar la cámara. Puedes escribir el código a mano.";
};
const TONE = { added: "text-emerald-300", level: "text-emerald-300", new: "text-amber-300", error: "text-red-300" };
const MARK = { added: "✓", level: "✓", new: "＋", error: "⚠" };
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";
const tabCls = (on) => `h-11 flex-1 rounded-xl text-sm font-semibold ${focusRing} ${on ? "bg-white text-stone-900" : "bg-white/15 text-white"}`;

export default function Scanner({ items, onCode, onAdjust, onFresh, onNewFresh, onClose, paused }) {
  const videoRef = useRef(null);
  const dialogRef = useRef(null);
  const seen = useRef({ code: "", t: 0 });
  const [tab, setTab] = useState("scan"); // scan | fresh
  const inactive = paused || tab !== "scan";
  const live = useRef({ inactive, onCode });
  live.current = { inactive, onCode };
  const [feed, setFeed] = useState([]);
  const [camError, setCamError] = useState("");
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);

  // Mientras el código siga a la vista no se repite; hay que apartarlo >1,5 s para volver a contarlo.
  const process = async (raw, force) => {
    if (live.current.inactive) return;
    const now = Date.now();
    const same = seen.current.code === raw && now - seen.current.t < 1500;
    seen.current = { code: raw, t: now };
    if (same && !force) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
    const res = await live.current.onCode(raw);
    setFeed((f) => [{ ...res, added: res.step, id: `${now}-${raw}` }, ...f].slice(0, 6));
  };

  // Al reanudar, el código que sigue a la vista no debe contarse otra vez.
  useEffect(() => { if (!inactive) seen.current.t = Date.now(); }, [inactive]);

  useEffect(() => {
    const opener = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape" && !live.current.inactive) onClose(); };
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

  // Ajusta la última lectura; la app aprende esa cantidad como la habitual del producto.
  const adjust = (entry, delta) => {
    const next = Math.max(0, round(entry.added + delta));
    const d = round(next - entry.added);
    if (d === 0) return;
    onAdjust(entry.itemId, d, next);
    setFeed((f) => f.map((e) => (e.id === entry.id ? { ...e, added: next } : e)));
  };

  const last = feed[0]?.type === "added" ? feed[0] : null;
  const lastItem = last ? items.find((i) => i.id === last.itemId) : null;
  const fresh = items.filter((i) => i.unit === LEVEL_UNIT)
    .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name, "es"));

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Escanear compras" tabIndex={-1}
         className="fixed inset-0 z-30 flex flex-col bg-black pt-[env(safe-area-inset-top)] text-white outline-none">
      <div className="flex items-center justify-between px-4 py-2">
        <h2 className="font-semibold">Guardar compras</h2>
        <button onClick={onClose} className={`h-11 rounded-xl bg-white/15 px-4 text-sm font-semibold ${focusRing}`}>Terminar</button>
      </div>
      <div className="flex gap-2 px-4 pb-2">
        <button aria-pressed={tab === "scan"} onClick={() => setTab("scan")} className={tabCls(tab === "scan")}>Código de barras</button>
        <button aria-pressed={tab === "fresh"} onClick={() => setTab("fresh")} className={tabCls(tab === "fresh")}>Frescos</button>
      </div>

      <div className={`relative min-h-0 flex-1 overflow-hidden ${tab === "scan" ? "" : "hidden"}`}>
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" className="h-full w-full object-cover" />
        {!camError && (
          <div aria-hidden="true" className={`pointer-events-none absolute left-1/2 top-1/2 h-32 w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-4 transition-colors ${flash ? "border-emerald-400" : "border-white/80"}`} />
        )}
        {paused && <p className="absolute inset-x-4 top-4 rounded-xl bg-black/75 p-3 text-center text-sm">Completa el producto para seguir escaneando.</p>}
        {camError && <p role="alert" className="absolute inset-4 flex items-center justify-center rounded-2xl bg-stone-900 p-4 text-center text-sm">{camError}</p>}
      </div>

      {tab === "scan" ? (
        <div className="space-y-3 bg-stone-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <ul role="log" aria-live="polite" className="max-h-28 space-y-1 overflow-y-auto text-sm">
            {feed.length === 0 && <li className="text-stone-400">Apunta la cámara al código de barras de cada producto.</li>}
            {feed.map((f) => {
              const it = f.itemId ? items.find((i) => i.id === f.itemId) : null;
              const text = f.type === "added" && it
                ? `${it.emoji} ${it.name} +${nf.format(f.added)} (ahora ${nf.format(it.qty)} ${it.unit})` : f.msg;
              return <li key={f.id} className={TONE[f.type]}><span aria-hidden="true">{MARK[f.type]} </span>{text}</li>;
            })}
          </ul>
          {lastItem && (
            <div role="group" aria-label={`Ajustar la última lectura de ${lastItem.name}`} className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-stone-400">Ajustar</span>
              {stepsFor(lastItem.unit).map((d) => (
                <button key={d} onClick={() => adjust(last, d)} aria-label={`${d > 0 ? "Sumar" : "Restar"} ${nf.format(Math.abs(d))} a ${lastItem.name}`}
                  className={`h-11 flex-1 rounded-xl bg-white/15 text-sm font-semibold ${focusRing}`}>{fmtDelta(d)}</button>
              ))}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { process(manual.trim(), true); setManual(""); } }}>
            <input name="codigo" inputMode="numeric" autoComplete="off" value={manual} onChange={(e) => setManual(e.target.value)}
              aria-label="Escribir código de barras" placeholder="O escribe el código…"
              className="h-11 min-w-0 flex-1 rounded-xl border border-stone-600 bg-stone-800 px-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" />
            <button className={`h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold ${focusRing}`}>Agregar</button>
          </form>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-stone-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-stone-300">Toca lo que compraste para marcarlo como «Hay». Primero aparece lo que se acabó o queda poco.</p>
          <ul className="grid grid-cols-2 gap-2">
            {fresh.map((i) => (
              <li key={i.id}>
                <button onClick={() => onFresh(i.id)} aria-label={`${i.name}: ${LEVEL_TEXT[i.qty] ?? "Hay"}. Marcar como hay`}
                  className={`flex min-h-16 w-full items-center gap-2 rounded-xl border-2 p-3 text-left ${focusRing} ${LEVEL_STYLE[i.qty] ?? LEVEL_STYLE[2]}`}>
                  <span aria-hidden="true" className="text-2xl">{i.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.name}</span>
                    <span className="block text-xs text-stone-300">{i.qty >= 2 ? "✓ Hay" : LEVEL_TEXT[i.qty]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {fresh.length === 0 && <p className="text-sm text-stone-400">Aún no tienes productos por nivel. Crea el primero: tomate, cebolla, pollo, queso…</p>}
          <button onClick={onNewFresh} className={`h-11 w-full rounded-xl bg-emerald-700 text-sm font-semibold ${focusRing}`}>＋ Nuevo producto fresco</button>
        </div>
      )}
    </div>
  );
}

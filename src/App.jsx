import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Search, Moon, Sun, Plus, Minus, Pencil, Trash2, X, ShoppingCart,
  PackageX, PackageCheck, LayoutGrid, MessageCircle, Copy, Users, ScanBarcode,
} from "lucide-react";
import { cloudEnabled, newHouseId } from "./supabase";
import { useCloudSync } from "./useCloudSync";
import { normalizeBarcode, lookupProduct } from "./barcode";

const Scanner = lazy(() => import("./Scanner.jsx")); // la cámara solo se descarga al usarla

/* ───────────── Datos y constantes ───────────── */
const ZONES = [
  { id: "refrigerador", name: "Refrigerador", emoji: "🧊" },
  { id: "congelador", name: "Congelador", emoji: "❄️" },
  { id: "alacena", name: "Alacena", emoji: "🥫" },
  { id: "especias", name: "Especias", emoji: "🌶️" },
  { id: "limpieza", name: "Limpieza", emoji: "🧽" },
];
const ZONE_IDS = ZONES.map((z) => z.id);
const UNITS = ["piezas", "litros", "kg", "g", "paquetes", "latas", "botellas"];

const MOCK = [
  ["Leche", "🥛", "refrigerador", 2, "litros"],
  ["Huevos", "🥚", "refrigerador", 12, "piezas"],
  ["Queso", "🧀", "refrigerador", 1, "paquetes"],
  ["Pollo", "🍗", "congelador", 2, "kg"],
  ["Helado", "🍨", "congelador", 1, "litros"],
  ["Harina", "🌾", "alacena", 0, "kg", 1],
  ["Arroz", "🍚", "alacena", 3, "kg"],
  ["Atún", "🐟", "alacena", 4, "latas"],
  ["Pimienta", "🧂", "especias", 1, "paquetes"],
  ["Orégano", "🌿", "especias", 0, "paquetes", 1],
  ["Detergente", "🧴", "limpieza", 1, "botellas"],
  ["Papel higiénico", "🧻", "limpieza", 6, "piezas"],
].map(([name, emoji, zone, qty, unit, par], i) => ({
  id: `m${i}`, name, emoji, zone, qty, unit, par: par ?? qty,
}));

/* ───────────── Utilidades ───────────── */
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
const round = (n) => Math.round(n * 1000) / 1000; // evita 0.1 + 0.2
const norm = (s) => String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const nf = new Intl.NumberFormat("es", { maximumFractionDigits: 3 });
const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

const lastGrapheme = (s) => {
  const parts = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment)
    : Array.from(s);
  return parts.at(-1) ?? "";
};

const validItems = (v) =>
  Array.isArray(v) &&
  v.every((i) => i && typeof i.id === "string" && typeof i.name === "string" &&
    Number.isFinite(i.qty) && Number.isFinite(i.par) && ZONE_IDS.includes(i.zone));

function usePersistentState(key, initial, valid = () => true) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (valid(parsed)) return parsed;
      }
    } catch { /* datos corruptos o almacenamiento bloqueado */ }
    return initial;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin espacio */ }
  }, [key, value]);
  return [value, setValue];
}

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const z = p.get("zona");
  return { tab: z === "compras" || ZONE_IDS.includes(z) ? z : "todo", query: p.get("q") ?? "" };
}

const ring =
  "outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-100 dark:focus-visible:ring-offset-[#0f1a16]";
const iconBtn = `flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ring}`;
const muted = "text-stone-500 dark:text-stone-400";

/* ───────────── Casa compartida ───────────── */
const HOUSE_KEY = "despensa:casa";
const houseFromText = (t) => {
  const m = String(t).match(/casa=([\w-]+)/);
  const code = (m ? m[1] : String(t)).trim();
  return /^[\w-]{32,}$/.test(code) ? code : null;
};
function initHouse() {
  if (!cloudEnabled) return null;
  const fromUrl = houseFromText(`casa=${new URLSearchParams(window.location.search).get("casa") ?? ""}`);
  let id = fromUrl;
  try { id = id ?? localStorage.getItem(HOUSE_KEY); } catch { /* sin almacenamiento */ }
  id = id ?? newHouseId();
  try { localStorage.setItem(HOUSE_KEY, id); } catch { /* sin almacenamiento */ }
  return id;
}

/* ───────────── WhatsApp ───────────── */
// Número fijo opcional (solo dígitos con código de país, ej. 573001234567).
// Si está vacío, WhatsApp te deja elegir el contacto o grupo.
const WHATSAPP_PHONE = (import.meta.env.VITE_WHATSAPP_PHONE ?? "").replace(/\D/g, "");

function buildShoppingMessage(items) {
  const lines = ["🛒 *Lista de compras*", ""];
  for (const z of ZONES) {
    const list = items.filter((i) => i.zone === z.id);
    if (!list.length) continue;
    lines.push(`${z.emoji} *${z.name}*`);
    list.forEach((i) => lines.push(`• ${i.name} – ${nf.format(i.par)} ${i.unit}`));
    lines.push("");
  }
  return lines.join("\n").trim();
}
const whatsappUrl = (text) => `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(text)}`;

/* ───────────── App ───────────── */
export default function App() {
  const [items, setLocal] = usePersistentState("despensa:items", MOCK, validItems);
  const [houseId, setHouseId] = useState(initHouse);
  const { setItems, status, detail } = useCloudSync(houseId, items, setLocal);
  const [sharing, setSharing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [dark, setDark] = usePersistentState("despensa:dark", prefersDark(), (v) => typeof v === "boolean");
  const initialView = useRef(readUrl()).current;
  const [tab, setTab] = useState(initialView.tab); // todo | id de zona | compras
  const [query, setQuery] = useState(initialView.query);
  const [editing, setEditing] = useState(null); // null | "new" | item
  const [toast, setToast] = useState(null);
  const timer = useRef();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1a16" : "#f5f5f4");
  }, [dark]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "todo") p.set("zona", tab);
    if (query.trim()) p.set("q", query.trim());
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [tab, query]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const notify = (msg, undo) => {
    clearTimeout(timer.current);
    setToast({ msg, undo });
    timer.current = setTimeout(() => setToast(null), 6000);
  };

  const soldOut = items.filter((i) => i.qty === 0);
  const q = query.trim().toLowerCase();
  const match = (i) => i.name.toLowerCase().includes(q);
  const visible = items.filter((i) => (tab === "todo" || i.zone === tab) && match(i));

  const update = (id, patch) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const changeQty = (item, delta) => {
    const qty = Math.max(0, round(item.qty + delta));
    update(item.id, { qty, par: delta > 0 ? Math.max(item.par, qty) : item.par });
  };
  const markSoldOut = (item) => {
    update(item.id, { qty: 0, par: Math.max(item.par, item.qty) });
    notify(`«${item.name}» agregado a la lista de compras`, () => update(item.id, { qty: item.qty }));
  };
  const restock = (item) => {
    update(item.id, { qty: Math.max(1, item.par) });
    notify(`«${item.name}» reabastecido`, () => update(item.id, { qty: 0 }));
  };
  const remove = (item) => {
    const index = items.findIndex((i) => i.id === item.id);
    setItems((l) => l.filter((i) => i.id !== item.id));
    notify(`«${item.name}» eliminado`, () =>
      setItems((l) => [...l.slice(0, index), item, ...l.slice(index)]));
  };
  const save = (data) => {
    // Producto escaneado cuyo nombre ya existe sin código: se vincula en vez de duplicarlo.
    if (!data.id && data.barcode) {
      const twin = itemsRef.current.find((i) => !i.barcode && norm(i.name) === norm(data.name));
      if (twin) {
        const qty = round(twin.qty + data.qty);
        update(twin.id, { barcode: data.barcode, qty, par: Math.max(twin.par, qty) });
        setEditing(null);
        notify(`Código vinculado a «${twin.name}» (+${nf.format(data.qty)})`);
        return;
      }
    }
    setItems((l) =>
      data.id
        ? l.map((i) => i.id === data.id
            ? { ...i, ...data, par: data.qty > 0 && data.qty !== i.qty ? data.qty : i.par }
            : i)
        : [...l, { ...data, id: uid(), par: Math.max(1, data.qty), order: Date.now() }]
    );
    setEditing(null);
  };

  // Cada lectura suma 1 unidad. Si el código es nuevo, se busca y se pide confirmar el producto.
  const scanCode = async (raw) => {
    const code = normalizeBarcode(raw);
    if (!code) return { type: "error", msg: `Código no válido: ${String(raw).slice(0, 20)}` };
    const item = itemsRef.current.find((i) => i.barcode === code);
    if (item) {
      const qty = round(item.qty + 1);
      update(item.id, { qty, par: Math.max(item.par, qty) });
      return { type: "added", msg: `${item.emoji} ${item.name} +1 (ahora ${nf.format(qty)} ${item.unit})` };
    }
    const info = await lookupProduct(code);
    setEditing({ name: info?.name ?? "", emoji: info?.emoji ?? "🛒", zone: info?.zone ?? "alacena", qty: 1, unit: "piezas", barcode: code });
    return { type: "new", msg: info ? `Producto nuevo: ${info.name}. Confírmalo.` : `Código ${code} sin datos. Escribe el nombre una vez.` };
  };

  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(buildShoppingMessage(soldOut));
      notify("Lista copiada");
    } catch {
      notify("No se pudo copiar la lista");
    }
  };

  const soldOutLabel = `${soldOut.length} ${soldOut.length === 1 ? "agotado" : "agotados"}`;

  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900 transition-colors dark:bg-[#0f1a16] dark:text-stone-100"
         style={{ fontFamily: "'Bricolage Grotesque', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-100/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-emerald-950 dark:bg-[#0f1a16]/90">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-xl font-bold tracking-tight">Mi despensa</h1>
          <div className="relative order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search" name="buscar" aria-label="Buscar producto" autoComplete="off" spellCheck={false}
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej. leche…"
              className="h-11 w-full rounded-xl border border-stone-300 bg-white pl-9 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-emerald-900 dark:bg-[#16261f]"
            />
          </div>
          <button onClick={() => setTab("compras")}
            className={`ml-auto flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold sm:ml-0 ${ring} ${
              soldOut.length ? "bg-red-600 text-white" : "bg-stone-200 text-stone-600 dark:bg-emerald-950 dark:text-stone-300"}`}>
            <PackageX aria-hidden="true" className="h-4 w-4" />
            <span aria-live="polite">{soldOutLabel}</span>
          </button>
          {cloudEnabled && (
            <button onClick={() => setSharing(true)} aria-label="Compartir despensa"
              className={`${iconBtn} relative border border-stone-300 hover:bg-stone-200 dark:border-emerald-900 dark:hover:bg-emerald-950`}>
              <Users aria-hidden="true" className="h-5 w-5" />
              <span aria-hidden="true" className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${
                status === "online" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-amber-500"}`} />
            </button>
          )}
          <button onClick={() => setDark(!dark)} aria-label={dark ? "Activar modo claro" : "Activar modo oscuro"}
            className={`${iconBtn} border border-stone-300 hover:bg-stone-200 dark:border-emerald-900 dark:hover:bg-emerald-950`}>
            {dark ? <Sun aria-hidden="true" className="h-5 w-5" /> : <Moon aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>

        <nav aria-label="Zonas" className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 pb-3 pt-1">
          <Tab active={tab === "todo"} onClick={() => setTab("todo")}>
            <LayoutGrid aria-hidden="true" className="h-4 w-4" /> Todo
          </Tab>
          {ZONES.map((z) => (
            <Tab key={z.id} active={tab === z.id} onClick={() => setTab(z.id)}>
              <span aria-hidden="true">{z.emoji}</span> {z.name}
            </Tab>
          ))}
          <Tab active={tab === "compras"} onClick={() => setTab("compras")} accent>
            <ShoppingCart aria-hidden="true" className="h-4 w-4" /> Lista de compras
            {soldOut.length > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{soldOut.length}</span>
            )}
          </Tab>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 pb-32">
        {tab === "compras" ? (
          <ShoppingList items={soldOut.filter(match)} allItems={soldOut} searching={!!q} query={query.trim()} onRestock={restock} onCopy={copyList} />
        ) : visible.length === 0 ? (
          <p className={`py-16 text-center ${muted}`}>
            {q ? `Sin resultados para «${query.trim()}».` : "No hay productos en esta zona. Pulsa Agregar para crear uno."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <ItemCard key={item.id} item={item}
                onQty={changeQty} onSoldOut={markSoldOut}
                onEdit={() => setEditing(item)} onDelete={() => remove(item)} />
            ))}
          </div>
        )}
      </main>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-[max(6.5rem,calc(env(safe-area-inset-bottom)+6rem))] z-50 mx-auto max-w-sm">
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
            <span className="min-w-0 flex-1 break-words">{toast.msg}</span>
            {toast.undo && (
              <button onClick={() => { toast.undo(); setToast(null); }}
                className={`h-11 shrink-0 rounded-lg px-3 font-semibold text-emerald-300 dark:text-emerald-800 ${ring}`}>
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-20 flex items-center gap-2">
        <button onClick={() => setScanning(true)}
          className={`flex h-14 items-center gap-2 rounded-full bg-stone-900 px-4 font-semibold text-white shadow-lg hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white ${ring}`}>
          <ScanBarcode aria-hidden="true" className="h-5 w-5" /> Escanear compras
        </button>
        <button onClick={() => setEditing("new")}
          className={`flex h-14 items-center gap-2 rounded-full bg-emerald-700 px-5 font-semibold text-white shadow-lg hover:bg-emerald-600 ${ring}`}>
          <Plus aria-hidden="true" className="h-5 w-5" /> Agregar
        </button>
      </div>

      {sharing && (
        <ShareModal houseId={houseId} status={status} detail={detail} onClose={() => setSharing(false)}
          onJoin={(id) => { try { localStorage.setItem(HOUSE_KEY, id); } catch { /* ignorar */ } setHouseId(id); setSharing(false); notify("Conectado a la despensa compartida"); }} />
      )}

      {scanning && (
        <Suspense fallback={null}>
          <Scanner paused={!!editing} onClose={() => setScanning(false)} onCode={scanCode} />
        </Suspense>
      )}

      {editing && (
        <ProductModal
          names={editing !== "new" && !editing.id && editing.barcode ? items.filter((i) => !i.barcode).map((i) => i.name) : undefined}
          initial={editing === "new" ? { zone: ZONE_IDS.includes(tab) ? tab : "alacena" } : editing}
          onClose={() => setEditing(null)} onSave={save} />
      )}
    </div>
  );
}

/* ───────────── Componentes ───────────── */
function Tab({ active, accent, children, ...props }) {
  return (
    <button {...props} aria-pressed={active}
      className={`flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${ring} ${
        active
          ? accent ? "border-red-600 bg-red-600 text-white" : "border-emerald-700 bg-emerald-700 text-white"
          : "border-stone-300 bg-white hover:bg-stone-200 dark:border-emerald-900 dark:bg-[#16261f] dark:hover:bg-emerald-950"}`}>
      {children}
    </button>
  );
}

function ItemCard({ item, onQty, onSoldOut, onEdit, onDelete }) {
  const out = item.qty === 0;
  const zone = ZONES.find((z) => z.id === item.zone);
  return (
    <article className={`rounded-2xl border p-4 transition-colors ${
      out ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
          : "border-stone-200 bg-white dark:border-emerald-950 dark:bg-[#16261f]"}`}>
      <div className="flex items-start gap-2">
        <div className={`flex min-w-0 flex-1 items-start gap-3 ${out ? "opacity-60" : ""}`}>
          <span aria-hidden="true" className="text-4xl leading-none">{item.emoji}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold" title={item.name}>{item.name}</h2>
            <p className={`truncate text-sm ${muted}`}>{zone?.name}</p>
          </div>
        </div>
        <button onClick={onEdit} aria-label={`Editar ${item.name}`}
          className={`${iconBtn} ${muted} hover:bg-stone-200 dark:hover:bg-emerald-950`}>
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </button>
        <button onClick={onDelete} aria-label={`Eliminar ${item.name}`}
          className={`${iconBtn} ${muted} hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950`}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {out && <span className="mt-2 inline-block rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">Agotado</span>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => onQty(item, -1)} disabled={out} aria-label={`Restar uno a ${item.name}`}
            className={`${iconBtn} border border-stone-300 hover:bg-stone-200 disabled:opacity-40 dark:border-emerald-900 dark:hover:bg-emerald-950`}>
            <Minus aria-hidden="true" className="h-4 w-4" />
          </button>
          <div className="min-w-14 text-center">
            <div className="text-xl font-bold leading-tight tabular-nums">{nf.format(item.qty)}</div>
            <div className={`text-xs ${muted}`}>{item.unit}</div>
          </div>
          <button onClick={() => onQty(item, 1)} aria-label={`Sumar uno a ${item.name}`}
            className={`${iconBtn} border border-stone-300 hover:bg-stone-200 dark:border-emerald-900 dark:hover:bg-emerald-950`}>
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <button onClick={() => onSoldOut(item)} disabled={out}
          className={`h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 ${ring}`}>
          Agotado
        </button>
      </div>
    </article>
  );
}

function ShoppingList({ items, allItems, searching, query, onRestock, onCopy }) {
  if (items.length === 0)
    return (
      <div className={`py-16 text-center ${muted}`}>
        <PackageCheck aria-hidden="true" className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
        {searching ? `Sin resultados para «${query}».` : "Nada por comprar. Los productos agotados aparecerán aquí."}
      </div>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <a href={whatsappUrl(buildShoppingMessage(allItems))} target="_blank" rel="noopener noreferrer"
          className={`flex h-11 items-center gap-2 rounded-xl bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-600 ${ring}`}>
          <MessageCircle aria-hidden="true" className="h-4 w-4" /> Enviar por WhatsApp
        </a>
        <button onClick={onCopy}
          className={`flex h-11 items-center gap-2 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-200 dark:border-emerald-900 dark:hover:bg-emerald-950 ${ring}`}>
          <Copy aria-hidden="true" className="h-4 w-4" /> Copiar lista
        </button>
      </div>
      {ZONES.map((z) => {
        const list = items.filter((i) => i.zone === z.id);
        if (!list.length) return null;
        return (
          <section key={z.id}>
            <h2 className="mb-2 font-semibold"><span aria-hidden="true">{z.emoji}</span> {z.name}</h2>
            <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:divide-emerald-950 dark:border-emerald-950 dark:bg-[#16261f]">
              {list.map((i) => (
                <li key={i.id} className="flex items-center gap-3 p-3">
                  <span aria-hidden="true" className="text-2xl">{i.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={i.name}>{i.name}</p>
                    <p className={`text-sm ${muted}`}>Habitual: {nf.format(i.par)} {i.unit}</p>
                  </div>
                  <button onClick={() => onRestock(i)} aria-label={`Reabastecer ${i.name}`}
                    className={`h-11 shrink-0 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-600 ${ring}`}>
                    Reabastecer
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ProductModal({ initial, names, onClose, onSave }) {
  const [f, setF] = useState(() => ({
    name: "", emoji: "🛒", zone: "alacena", qty: 1, unit: "piezas", ...initial,
  }));
  const start = useRef(JSON.stringify(f));
  const dirty = JSON.stringify(f) !== start.current;
  const [errors, setErrors] = useState({});
  const dialogRef = useRef();
  const nameRef = useRef();
  const qtyRef = useRef();
  const set = (k, v) => {
    setF((s) => ({ ...s, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  useEffect(() => {
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (window.matchMedia("(pointer: fine)").matches) nameRef.current?.focus();
    else dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Escape") return onClose();
    if (e.key !== "Tab") return;
    const list = [...dialogRef.current.querySelectorAll("button, input, select")].filter((el) => !el.disabled);
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const submit = (e) => {
    e.preventDefault();
    const name = f.name.trim();
    const qty = round(Number(f.qty));
    const errs = {};
    if (!name) errs.name = "Escribe un nombre para el producto.";
    if (String(f.qty).trim() === "" || !Number.isFinite(qty) || qty < 0) errs.qty = "Escribe una cantidad de 0 o más.";
    setErrors(errs);
    if (errs.name) return nameRef.current.focus();
    if (errs.qty) return qtyRef.current.focus();
    onSave({ ...f, name, qty, emoji: f.emoji || "🛒" });
  };

  const field = "h-11 w-full rounded-xl border border-stone-300 bg-white px-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 aria-[invalid=true]:border-red-500 dark:border-emerald-900 dark:bg-[#0f1a16] dark:text-stone-100";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}
           onKeyDown={onKeyDown}
           className="max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-stone-50 shadow-xl outline-none dark:bg-[#16261f] sm:rounded-3xl">
        <form noValidate onSubmit={submit} className="space-y-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <h2 id="modal-title" className="text-lg font-bold">{f.id ? "Editar producto" : "Agregar producto"}</h2>
            <button type="button" onClick={onClose} aria-label="Cerrar" className={`${iconBtn} hover:bg-stone-200 dark:hover:bg-emerald-950`}>
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>

          <div className="flex gap-3">
            <label className="w-20 text-sm">Emoji
              <input name="emoji" autoComplete="off" value={f.emoji} onChange={(e) => set("emoji", lastGrapheme(e.target.value))}
                className={`${field} mt-1 text-center text-2xl`} />
            </label>
            <label className="min-w-0 flex-1 text-sm">Nombre
              <input ref={nameRef} name="nombre" autoComplete="off" list={names?.length ? "nombres-despensa" : undefined} value={f.name} onChange={(e) => set("name", e.target.value)}
                placeholder="Ej. aceite de oliva…" aria-invalid={!!errors.name} aria-describedby={errors.name ? "err-name" : undefined}
                className={`${field} mt-1`} />
              {errors.name && <span id="err-name" role="alert" className="mt-1 block text-red-600 dark:text-red-400">{errors.name}</span>}
            </label>
          </div>

          {names?.length > 0 && <datalist id="nombres-despensa">{names.map((n) => <option key={n} value={n} />)}</datalist>}
          {f.barcode && (
            <p className={`text-xs ${muted}`}>
              Código de barras: <span className="font-mono">{f.barcode}</span>. Si ya tienes este producto, escribe su nombre igual y se vinculará.
            </p>
          )}

          <label className="block text-sm">Zona
            <select name="zona" autoComplete="off" value={f.zone} onChange={(e) => set("zone", e.target.value)} className={`${field} mt-1`}>
              {ZONES.map((z) => <option key={z.id} value={z.id}>{z.emoji} {z.name}</option>)}
            </select>
          </label>

          <div className="flex gap-3">
            <label className="w-32 text-sm">Cantidad
              <input ref={qtyRef} name="cantidad" type="number" inputMode="decimal" min="0" step="any" autoComplete="off"
                value={f.qty} onChange={(e) => set("qty", e.target.value)}
                aria-invalid={!!errors.qty} aria-describedby={errors.qty ? "err-qty" : undefined}
                className={`${field} mt-1`} />
            </label>
            <label className="min-w-0 flex-1 text-sm">Unidad
              <select name="unidad" autoComplete="off" value={f.unit} onChange={(e) => set("unit", e.target.value)} className={`${field} mt-1`}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>
          {errors.qty && <p id="err-qty" role="alert" className="-mt-2 text-sm text-red-600 dark:text-red-400">{errors.qty}</p>}

          <button className={`h-12 w-full rounded-xl bg-emerald-700 font-semibold text-white hover:bg-emerald-600 ${ring}`}>
            {f.id ? "Guardar cambios" : "Agregar a la despensa"}
          </button>
        </form>
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  online: "Sincronizado", connecting: "Conectando…", offline: "Sin conexión (se sincronizará al volver)",
  error: "Error de sincronización. Revisa que ejecutaste el SQL de Supabase y activaste el acceso anónimo.", local: "Solo en este dispositivo",
};

function ShareModal({ houseId, status, detail, onClose, onJoin }) {
  const ref = useRef();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?casa=${houseId}`;

  useEffect(() => {
    const opener = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => { document.body.style.overflow = prev; opener?.focus?.(); };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Escape") return onClose();
    if (e.key !== "Tab") return;
    const list = [...ref.current.querySelectorAll("button, input, a[href]")].filter((el) => !el.disabled);
    const first = list[0], last = list[list.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("No se pudo copiar. Selecciona el enlace y cópialo a mano."); }
  };
  const join = (e) => {
    e.preventDefault();
    const id = houseFromText(code);
    if (!id) return setError("Código no válido. Pega el enlace de invitación completo.");
    onJoin(id);
  };

  const field = "h-11 w-full rounded-xl border border-stone-300 bg-white px-3 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-emerald-900 dark:bg-[#0f1a16]";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="share-title" tabIndex={-1} onKeyDown={onKeyDown}
           className="max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-t-3xl bg-stone-50 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl outline-none dark:bg-[#16261f] sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 id="share-title" className="text-lg font-bold">Compartir despensa</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className={`${iconBtn} hover:bg-stone-200 dark:hover:bg-emerald-950`}>
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div role="status" className={`space-y-1 text-sm ${muted}`}>
          <p>Estado: {STATUS_TEXT[status]}</p>
          {detail && <p className="break-words text-red-600 dark:text-red-400">{detail}</p>}
          <p>Código de esta despensa: <strong className="font-mono">…{houseId.slice(-6)}</strong> (debe ser igual en todos tus dispositivos)</p>
        </div>

        <section className="space-y-2">
          <h3 className="font-semibold">Invitar a alguien de tu casa</h3>
          <p className={`text-sm ${muted}`}>Quien tenga este enlace puede ver y editar tu despensa. Compártelo solo con personas de confianza.</p>
          <input readOnly value={link} aria-label="Enlace de invitación" onFocus={(e) => e.target.select()} className={`${field} text-sm`} />
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className={`flex h-11 items-center gap-2 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-200 dark:border-emerald-900 dark:hover:bg-emerald-950 ${ring}`}>
              <Copy aria-hidden="true" className="h-4 w-4" /> {copied ? "¡Copiado!" : "Copiar enlace"}
            </button>
            <a href={whatsappUrl(`Únete a nuestra despensa: ${link}`)} target="_blank" rel="noopener noreferrer"
              className={`flex h-11 items-center gap-2 rounded-xl bg-green-700 px-4 text-sm font-semibold text-white hover:bg-green-600 ${ring}`}>
              <MessageCircle aria-hidden="true" className="h-4 w-4" /> Invitar por WhatsApp
            </a>
          </div>
        </section>

        <form onSubmit={join} noValidate className="space-y-2 border-t border-stone-200 pt-4 dark:border-emerald-950">
          <h3 className="font-semibold">Unirme a otra despensa</h3>
          <input name="codigo" autoComplete="off" spellCheck={false} aria-label="Enlace o código de invitación"
            value={code} onChange={(e) => { setCode(e.target.value); setError(""); }}
            placeholder="Pega aquí el enlace de invitación…" aria-invalid={!!error} className={field} />
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button className={`h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600 ${ring}`}>Unirme</button>
          <p className={`text-xs ${muted}`}>Al unirte verás la lista de esa despensa en lugar de la actual.</p>
        </form>
      </div>
    </div>
  );
}

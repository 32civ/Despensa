import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, cloudEnabled } from "./supabase";

const toRow = (houseId, it) => ({
  household_id: houseId, id: it.id, name: it.name, emoji: it.emoji, zone: it.zone,
  qty: it.qty, unit: it.unit, par: it.par, sort_order: it.order ?? 0,
});
const fromRow = ({ household_id, sort_order, updated_at, ...rest }) => ({ ...rest, order: sort_order });

/**
 * Sincroniza `items` con la tabla public.items de Supabase.
 * Devuelve un setItems con la misma forma que el de useState, que además
 * escribe en la nube solo los campos que cambiaron.
 * status: local | connecting | online | offline | error
 */
export function useCloudSync(houseId, items, setLocal) {
  const ref = useRef(items);
  const ready = useRef(false);
  const pending = useRef(0);
  const refreshRef = useRef(() => {});
  const [status, setStatus] = useState(cloudEnabled && houseId ? "connecting" : "local");
  const [detail, setDetail] = useState("");
  const fail = (msg, e) => { setStatus("error"); setDetail(e?.message ? `${msg}: ${e.message}` : msg); };

  useEffect(() => {
    if (!cloudEnabled || !houseId) { ready.current = false; setStatus("local"); return; }
    let stopped = false;
    let channel;
    let timer;
    ready.current = false;
    setStatus("connecting");
    const seededKey = `despensa:seeded:${houseId}`;

    const load = async () => {
      const { data, error } = await supabase.from("items").select("*")
        .eq("household_id", houseId).order("sort_order");
      if (stopped) return;
      if (error) return fail("No se pudieron leer los productos", error);
      if (pending.current > 0) return; // hay cambios nuestros en vuelo; se recarga al terminar
      if (data.length === 0 && !localStorage.getItem(seededKey)) {
        // Primera vez con esta casa: subir lo que hay en este dispositivo.
        localStorage.setItem(seededKey, "1");
        const rows = ref.current.map((it, n) => toRow(houseId, { ...it, order: it.order ?? n }));
        pending.current++;
        const res = rows.length ? await supabase.from("items").insert(rows) : {};
        pending.current--;
        if (res.error) return fail("No se pudo subir tu lista a la nube", res.error);
        ready.current = true;
        return setStatus("online");
      }
      localStorage.setItem(seededKey, "1");
      const next = data.map(fromRow);
      ready.current = true;
      ref.current = next;
      setLocal(next);
      setDetail("");
      setStatus("online");
    };
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
    refreshRef.current = refresh;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) return fail("No se pudo iniciar la sesión anónima (¿activaste Allow anonymous sign-ins?)", error);
      }
      const { error } = await supabase.rpc("join_household", { code: houseId });
      if (error) return fail("No se pudo unir a la casa (¿ejecutaste el SQL completo?)", error);
      if (stopped) return;
      channel = supabase.channel(`despensa-${houseId}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "items", filter: `household_id=eq.${houseId}` }, refresh)
        .subscribe((s) => {
          if (s === "SUBSCRIBED") load();
          else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("offline");
        });
    })().catch((e) => fail("Error de conexión", e));

    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    // Respaldo: Realtime no avisa de los borrados filtrados y puede cortarse en el celular.
    const poll = setInterval(() => { if (document.visibilityState === "visible" && ready.current) load(); }, 15000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
      ready.current = false;
    };
  }, [houseId, setLocal]);

  const setItems = useCallback((updater) => {
    const prev = ref.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    ref.current = next;
    setLocal(next);
    if (!ready.current) return;

    const before = new Map(prev.map((i) => [i.id, i]));
    const ops = [];
    const newRows = [];
    next.forEach((it, n) => {
      const old = before.get(it.id);
      if (!old) { newRows.push(toRow(houseId, { ...it, order: it.order ?? Date.now() + n })); return; }
      const patch = {};
      for (const [k, v] of Object.entries(it)) {
        if (k !== "id" && v !== old[k]) patch[k === "order" ? "sort_order" : k] = v;
      }
      if (Object.keys(patch).length)
        ops.push(supabase.from("items").update(patch).eq("household_id", houseId).eq("id", it.id));
    });
    if (newRows.length) ops.push(supabase.from("items").upsert(newRows));
    prev.filter((i) => !next.some((n) => n.id === i.id)).forEach((i) =>
      ops.push(supabase.from("items").delete().eq("household_id", houseId).eq("id", i.id)));
    if (!ops.length) return;

    pending.current++;
    Promise.all(ops)
      .then((rs) => { const bad = rs.find((r) => r.error); if (bad) fail("No se pudo guardar el cambio", bad.error); })
      .catch((e) => fail("Error de conexión al guardar", e))
      .finally(() => { pending.current--; if (pending.current === 0) refreshRef.current(); });
  }, [houseId, setLocal]);

  return { setItems, status, detail };
}

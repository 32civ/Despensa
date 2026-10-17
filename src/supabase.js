import { createClient } from "@supabase/supabase-js";

// Tolerante a errores al pegar las variables: quita comillas, espacios y cualquier
// ruta extra (ej. "/rest/v1/"), que provoca "Invalid path specified in request URL".
const clean = (v) => String(v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
const toOrigin = (v) => {
  const raw = clean(v);
  if (!raw) return "";
  for (const candidate of [raw, `https://${raw}`]) {
    try { return new URL(candidate).origin; } catch { /* probar la siguiente */ }
  }
  return "";
};
const url = toOrigin(import.meta.env.VITE_SUPABASE_URL);
const key = clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

// Sin variables de entorno la app funciona solo en local (LocalStorage).
export const cloudEnabled = Boolean(url && key);
export const supabase = cloudEnabled ? createClient(url, key) : null;

// El código de la casa funciona como contraseña: debe ser largo e impredecible.
export const newHouseId = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

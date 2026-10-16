import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Sin variables de entorno la app funciona solo en local (LocalStorage).
export const cloudEnabled = Boolean(url && key);
export const supabase = cloudEnabled ? createClient(url, key) : null;

// El código de la casa funciona como contraseña: debe ser largo e impredecible.
export const newHouseId = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

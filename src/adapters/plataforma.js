import { Capacitor } from "@capacitor/core";

// "android" | "electron" | "web"
export const plataforma =
  window.capatazNativo ? "electron" :
  Capacitor.isNativePlatform() ? Capacitor.getPlatform() :
  "web";
export const nativo = window.capatazNativo || null;

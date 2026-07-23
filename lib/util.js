import System from "system";
import GLib from "gi://GLib";

export function processId() {
  try {
    const pid = System.pid;
    return pid ?? 1;
  } catch {
    return 1;
  }
}

export function nonce() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function debounce(fn, ms) {
  let id = 0;
  const wrapped = (...args) => {
    if (id) GLib.source_remove(id);
    id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      id = 0;
      fn(...args);
      return GLib.SOURCE_REMOVE;
    });
  };
  wrapped.cancel = () => {
    if (id) {
      GLib.source_remove(id);
      id = 0;
    }
  };
  return wrapped;
}

export function nowMs() {
  return Date.now();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

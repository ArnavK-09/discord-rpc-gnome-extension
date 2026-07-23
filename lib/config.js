import GLib from "gi://GLib";

export const OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
};

export const CMD = {
  SET_ACTIVITY: "SET_ACTIVITY",
  DISPATCH: "DISPATCH",
};

export const ACTIVITY_TYPES = [
  { value: 0, label: "Playing", icon: "input-gaming-symbolic" },
  { value: 2, label: "Listening", icon: "audio-x-generic-symbolic" },
  { value: 3, label: "Watching", icon: "video-display-symbolic" },
  { value: 5, label: "Competing", icon: "preferences-system-symbolic" },
];

export const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, t.label]));

export const HANDSHAKE_TIMEOUT_S = 6;
export const PUSH_DEBOUNCE_MS = 600;
export const READ_CHUNK = 8192;

export function candidatePaths() {
  const dirs = [
    GLib.getenv("XDG_RUNTIME_DIR"),
    GLib.getenv("TMPDIR"),
    GLib.getenv("TMP"),
    GLib.getenv("TEMP"),
    "/tmp",
  ];
  const ordered = [...new Set(dirs.filter(Boolean))];
  const seen = new Set();
  const out = [];
  for (const dir of ordered) {
    for (let n = 0; n < 10; n++) {
      const path = `${dir}/discord-ipc-${n}`;
      if (!seen.has(path)) {
        seen.add(path);
        out.push(path);
      }
    }
  }
  return out;
}

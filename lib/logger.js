const TAG = "discord-rpc";

export function info(...args) {
  console.log(`[${TAG}] ${args.join(" ")}`);
}

export function warn(...args) {
  console.warn(`[${TAG}] ${args.join(" ")}`);
}

export function error(e, msg = "") {
  const body = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  console.error(`[${TAG}] ${msg} ${body}`.trim());
}

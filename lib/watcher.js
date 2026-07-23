import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { candidatePaths } from "./config.js";
import * as Log from "./logger.js";

Gio._promisify(Gio.SocketClient.prototype, "connect_async", "connect_finish");

const POLL_SECONDS = 5;

export class DiscordWatcher {
  constructor() {
    this._monitor = null;
    this._monitorConn = 0;
    this._timer = 0;
    this._running = false;
    this._cb = null;
    this._probeGen = 0;
  }

  setCallback(cb) {
    this._cb = cb;
  }

  get running() {
    return this._running;
  }

  start() {
    if (this._monitor || this._timer) return;
    this._refresh();
    try {
      const dir = GLib.getenv("XDG_RUNTIME_DIR") ?? "/run/user";
      const file = Gio.File.new_for_path(dir);
      this._monitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      this._monitorConn = this._monitor.connect("changed", () => this._refresh());
    } catch (e) {
      Log.error(e, "watcher monitor");
    }
    this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  stop() {
    if (this._timer) {
      GLib.source_remove(this._timer);
      this._timer = 0;
    }
    if (this._monitor) {
      if (this._monitorConn) this._monitor.disconnect(this._monitorConn);
      this._monitorConn = 0;
      try {
        this._monitor.cancel();
      } catch (e) {
        Log.error(e, "watcher cancel");
      }
      this._monitor = null;
    }
    this._running = false;
  }

  probe() {
    this._refresh();
  }

  async _refresh() {
    const gen = (this._probeGen += 1);
    const results = await Promise.allSettled(candidatePaths().map((p) => this._probe(p)));
    if (gen !== this._probeGen) return;
    const running = results.some((r) => r.status === "fulfilled");
    if (running === this._running) return;
    this._running = running;
    try {
      this._cb?.(running);
    } catch (e) {
      Log.error(e, "watcher callback");
    }
  }

  async _probe(path) {
    const client = new Gio.SocketClient();
    const connection = await client.connect_async(Gio.UnixSocketAddress.new(path), null);
    try {
      connection.close(null);
    } catch {}
  }

  destroy() {
    this.stop();
    this._cb = null;
  }
}

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import * as Log from "./logger.js";
import { PUSH_DEBOUNCE_MS, ACTIVITY_LABEL } from "./config.js";
import { debounce, nowMs, clamp } from "./util.js";

export const Status = {
  DISABLED: "disabled",
  NO_CLIENT_ID: "no-client-id",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
};

export const RpcController = GObject.registerClass(
  {
    GTypeName: "DiscordRpc_Controller",
    Signals: {
      status: { param_types: [GObject.TYPE_STRING] },
      "state-changed": {},
    },
  },
  class RpcController extends GObject.Object {
    _init(settings, ipc) {
      super._init();
      this._settings = settings;
      this._ipc = ipc;
      this._ipcConns = [];
      this._settingsConns = [];
      this._wasEnabled = false;
      this._cleanupTimer = 0;
      this._cleanupTries = 0;
      this._cleanupDone = false;
      this._push = debounce(() => this._pushActivity(), PUSH_DEBOUNCE_MS);
      this._bindSettings();
      this._bindIpc();
    }

    start() {
      this._cleanupStale();
      this.refresh();
    }

    async _cleanupStale() {
      if (this.enabled || !this.clientId || this._cleanupDone) return;
      this._cancelCleanupRetry();
      try {
        await this._ipc.open(this.clientId);
        if (this.enabled) return;
        await this._ipc.clearActivity();
        this._cleanupDone = true;
      } catch (e) {
        Log.error(e, "cleanup stale");
        this._scheduleCleanupRetry();
        return;
      } finally {
        if (!this.enabled) {
          this._ipc.destroy();
          this._setStatus(Status.DISABLED);
        }
      }
    }

    _scheduleCleanupRetry() {
      if (this._cleanupTimer || this._cleanupTries >= 6 || this.enabled || this._cleanupDone)
        return;
      this._cleanupTries += 1;
      this._cleanupTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
        this._cleanupTimer = 0;
        this._cleanupStale();
        return GLib.SOURCE_REMOVE;
      });
    }

    _cancelCleanupRetry() {
      if (this._cleanupTimer) {
        GLib.source_remove(this._cleanupTimer);
        this._cleanupTimer = 0;
      }
    }

    get enabled() {
      return this._settings.get_boolean("enabled");
    }

    get clientId() {
      return this._settings.get_string("client-id") ?? "";
    }

    snapshot() {
      return {
        enabled: this.enabled,
        activityType: this._settings.get_int("activity-type"),
        details: this._settings.get_string("details"),
        state: this._settings.get_string("state"),
        activityLabel: ACTIVITY_LABEL,
      };
    }

    setEnabled(value) {
      this._settings.set_boolean("enabled", !!value);
      Gio.Settings.sync();
    }

    setActivityType(value) {
      this._settings.set_int("activity-type", clamp(value, 0, 5));
      this._push();
    }

    setString(key, value) {
      this._settings.set_string(key, value ?? "");
    }

    refresh() {
      const justEnabled = this.enabled && !this._wasEnabled;
      this._wasEnabled = this.enabled;
      const showTimestamp = this._settings.get_boolean("show-timestamp");

      if (!this.enabled) {
        this._push.cancel();
        if (this._ipc.ready) this._gracefulDisconnect();
        this._setStatus(Status.DISABLED);
        this.emit("state-changed");
        return;
      }
      this._cancelCleanupRetry();
      if (showTimestamp && justEnabled) {
        this._settings.set_int64("timestamp-start", nowMs());
      }
      if (!this.clientId) {
        this._setStatus(Status.NO_CLIENT_ID);
        this.emit("state-changed");
        return;
      }
      if (this._ipc.ready) {
        this._pushActivity();
        this._setStatus(Status.CONNECTED);
      } else {
        this._ensureConnected();
      }
      this.emit("state-changed");
    }

    async _ensureConnected() {
      if (this._ipc.ready || this._ipc.connecting) return;
      this._setStatus(Status.CONNECTING);
      try {
        await this._ipc.open(this.clientId);
      } catch (e) {
        Log.error(e, "controller connect");
        this._autoOff();
      }
    }

    _autoOff() {
      if (!this.enabled) return;
      this.setEnabled(false);
    }

    async _gracefulDisconnect() {
      if (this._settings.get_boolean("clear-on-disable")) {
        try {
          await this._ipc.clearActivity();
        } catch (e) {
          Log.error(e, "clear on disable");
        }
      }
      this._ipc.destroy();
    }

    _pushActivity() {
      if (!this.enabled || !this.clientId) return;
      if (!this._ipc.ready) {
        this._ensureConnected();
        return;
      }
      const activity = this._buildActivity();
      this._ipc.setActivity(activity).catch((e) => Log.error(e, "push"));
    }

    _buildActivity() {
      const s = this._settings;
      const activity = { type: s.get_int("activity-type") };
      const title = (s.get_string("details") ?? "").trim();
      const caption = (s.get_string("state") ?? "").trim();
      if (title) activity.name = title;
      if (caption) activity.state = caption;

      if (s.get_boolean("show-images")) {
        const assets = {};
        const large = (s.get_string("large-image") ?? "").trim();
        const small = (s.get_string("small-image") ?? "").trim();
        if (large) {
          assets.large_image = large;
          const largeText = (s.get_string("large-text") ?? "").trim();
          if (largeText) assets.large_text = largeText;
        }
        if (small) {
          assets.small_image = small;
          const smallText = (s.get_string("small-text") ?? "").trim();
          if (smallText) assets.small_text = smallText;
        }
        if (Object.keys(assets).length) activity.assets = assets;
      }

      if (s.get_boolean("show-timestamp")) {
        let start = s.get_int64("timestamp-start");
        if (!start) {
          start = nowMs();
          s.set_int64("timestamp-start", start);
        }
        activity.timestamps = { start };
      }

      return activity;
    }

    _bindIpc() {
      this._ipcConns.push(
        this._ipc.connect("connected", () => {
          this._setStatus(Status.CONNECTED);
          this._pushActivity();
          this.emit("state-changed");
        }),
      );
      this._ipcConns.push(
        this._ipc.connect("disconnected", () => {
          this.emit("state-changed");
          this._autoOff();
        }),
      );
    }

    _bindSettings() {
      const reactive = [
        "client-id",
        "activity-type",
        "details",
        "state",
        "show-images",
        "large-image",
        "large-text",
        "small-image",
        "small-text",
        "show-timestamp",
        "timestamp-start",
        "clear-on-disable",
      ];
      for (const key of reactive) {
        this._settingsConns.push(
          this._settings.connect(`changed::${key}`, () => {
            this.refresh();
          }),
        );
      }
      this._settingsConns.push(
        this._settings.connect("changed::enabled", () => {
          this.refresh();
        }),
      );
    }

    _setStatus(status) {
      this.emit("status", status);
    }

    destroy() {
      this._push.cancel();
      this._cancelCleanupRetry();
      for (const id of this._ipcConns) this._ipc.disconnect(id);
      this._ipcConns = [];
      for (const id of this._settingsConns) this._settings.disconnect(id);
      this._settingsConns = [];
      this._ipc.destroy();
      this._settings = null;
      this._ipc = null;
    }
  },
);

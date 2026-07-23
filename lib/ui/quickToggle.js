import GObject from "gi://GObject";
import St from "gi://St";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { RpcPopup } from "./popup.js";
import { Status } from "../controller.js";
import { DiscordWatcher } from "../watcher.js";

export function quickMenuToggleAvailable() {
  return QuickSettings.QuickMenuToggle !== undefined;
}

export const QuickSettingsIndicator = GObject.registerClass(
  { GTypeName: "DiscordRpc_QuickSettingsIndicator" },
  class QuickSettingsIndicator extends GObject.Object {
    _init(controller, settings, gIcon, openPrefs) {
      super._init();
      this._controller = controller;
      this._settings = settings;
      this._gIcon = gIcon;
      this._openPrefs = openPrefs;
      this._toggleConns = [];
      this._controllerConns = [];
      this._settingsConns = [];
      this._syncing = false;
      this._lastStatus = Status.DISABLED;
      this._prevStatus = Status.DISABLED;

      this._onlyWhenOpen = settings.get_boolean("only-show-when-discord-open");
      this._watcher = new DiscordWatcher();
      this._watcher.setCallback(() => this._applyVisibility());

      this._toggle = new QuickSettings.QuickMenuToggle({
        title: "Discord RPC",
        toggleMode: true,
        gicon: gIcon,
        subtitle: "Off",
      });
      this._popup = new RpcPopup(this._toggle.menu, controller, gIcon);
      this._popupConn = this._popup.connect("open-prefs", () => this._openPrefs?.());

      this._toggleConns.push(
        this._toggle.connect("notify::checked", () => {
          if (this._syncing) return;
          this._controller.setEnabled(this._toggle.checked);
        }),
      );
      this._controllerConns.push(
        this._controller.connect("status", (_c, status) => this._update(status)),
      );
      this._controllerConns.push(
        this._controller.connect("state-changed", () => this._update(this._lastStatus)),
      );
      this._settingsConns.push(
        this._settings.connect("changed::only-show-when-discord-open", () => {
          this._onlyWhenOpen = this._settings.get_boolean("only-show-when-discord-open");
          this._syncWatcher();
          this._applyVisibility();
        }),
      );

      this._update(Status.DISABLED);
      this._syncWatcher();
      this._applyVisibility();
    }

    _syncWatcher() {
      if (this._onlyWhenOpen) this._watcher.start();
      else this._watcher.stop();
    }

    _applyVisibility() {
      this._toggle.visible = !this._onlyWhenOpen || this._watcher.running;
    }

    _update(status) {
      this._lastStatus = status;
      const snap = this._controller.snapshot();
      this._syncing = true;
      this._toggle.checked = snap.enabled;
      this._syncing = false;
      this._toggle.subtitle = this._subtitleFor(status, snap);
      this._toggle.menu.setHeader(this._gIcon, "Discord RPC", this._toggle.subtitle);
      if (status === Status.DISABLED && this._prevStatus !== Status.DISABLED) {
        this._watcher.probe();
        this._applyVisibility();
      }
      this._prevStatus = status;
    }

    _subtitleFor(status, snap) {
      if (!snap.enabled) return "Off";
      if (status === Status.NO_CLIENT_ID) return "Needs client ID";
      if (status === Status.CONNECTED) return snap.activityLabel?.[snap.activityType] ?? "Live";
      if (status === Status.CONNECTING) return "Connecting…";
      return "Off";
    }

    install() {
      this._container = new St.BoxLayout();
      this._container.quickSettingsItems = [this._toggle];
      Main.panel.statusArea.quickSettings.addExternalIndicator(this._container);
    }

    destroy() {
      for (const id of this._toggleConns) this._toggle.disconnect(id);
      for (const id of this._controllerConns) this._controller.disconnect(id);
      for (const id of this._settingsConns) this._settings.disconnect(id);
      this._toggleConns = [];
      this._controllerConns = [];
      this._settingsConns = [];
      this._watcher.destroy();
      if (this._popupConn) this._popup?.disconnect(this._popupConn);
      this._popup?.destroy();
      this._popup = null;
      this._toggle?.destroy();
      this._toggle = null;
      this._container?.destroy();
      this._container = null;
    }
  },
);

import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { DiscordIpc } from "./lib/discordIpc.js";
import { RpcController } from "./lib/controller.js";
import { QuickSettingsIndicator, quickMenuToggleAvailable } from "./lib/ui/quickToggle.js";
import * as Log from "./lib/logger.js";

export default class DiscordRpcExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._gIcon = Gio.icon_new_for_string(
      `${this.path}/icons/hicolor/scalable/actions/discord-rpc-symbolic.svg`,
    );
    this._controller = new RpcController(this._settings, new DiscordIpc());
    this._indicator = null;
    const openPrefs = () => this.openPreferences();
    if (quickMenuToggleAvailable()) {
      this._indicator = new QuickSettingsIndicator(
        this._controller,
        this._settings,
        this._gIcon,
        openPrefs,
      );
      this._indicator.install();
    } else {
      Log.error(new Error("Quick settings unavailable"), "enable");
    }
    this._controller.start();
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    this._controller?.destroy();
    this._controller = null;
    if (this._gIcon) {
      this._gIcon = null;
    }
    this._settings = null;
  }
}

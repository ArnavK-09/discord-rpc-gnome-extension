import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

import { ACTIVITY_TYPES } from "../config.js";
import { SectionLabel, EntryRow, TypeGrid, ActionButton } from "./widgets.js";

export const RpcPopup = GObject.registerClass(
  {
    GTypeName: "DiscordRpc_Popup",
    Signals: {
      "open-prefs": {},
    },
  },
  class RpcPopup extends GObject.Object {
    _init(menu, controller, gIcon) {
      super._init();
      this._menu = menu;
      this._controller = controller;
      this._gIcon = gIcon;
      this._conns = [];
      this._build();
      this._bindController();
      this._sync();
    }

    _build() {
      this._content = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style_class: "drpc-popup",
      });

      this._content.add_child(new SectionLabel("Activity type"));
      this._typeGrid = new TypeGrid(ACTIVITY_TYPES);
      this._typeGrid.connect("selected", (_g, value) => this._controller.setActivityType(value));
      this._content.add_child(this._typeGrid);

      this._content.add_child(new SectionLabel("Content"));

      this._details = new EntryRow({ label: "Title", placeholder: "Shows as the activity name" });
      this._details.connect("changed", (_r, text) => this._controller.setString("details", text));
      this._content.add_child(this._details);

      this._state = new EntryRow({ label: "Caption", placeholder: "A short sub-line" });
      this._state.connect("changed", (_r, text) => this._controller.setString("state", text));
      this._content.add_child(this._state);

      const settingsBtn = new ActionButton({ label: "Advanced settings" });
      settingsBtn.connect("clicked", () => this.emit("open-prefs"));
      this._content.add_child(settingsBtn);

      this._menu.box.add_child(this._content);
    }

    _bindController() {
      this._conns.push(this._controller.connect("state-changed", () => this._sync()));
    }

    _sync() {
      const snap = this._controller.snapshot();
      this._typeGrid.setActive(snap.activityType);
      this._details.text = snap.details;
      this._state.text = snap.state;
    }

    destroy() {
      for (const id of this._conns) this._controller.disconnect(id);
      this._conns = [];
      this._menu?.close();
      this._content?.destroy();
      this._content = null;
    }
  },
);

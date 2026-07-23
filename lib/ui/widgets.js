import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

export const SectionLabel = GObject.registerClass(
  { GTypeName: "DiscordRpc_SectionLabel" },
  class SectionLabel extends St.Label {
    _init(text) {
      super._init({ text, x_expand: true, style_class: "drpc-section" });
    }
  },
);

export const EntryRow = GObject.registerClass(
  {
    GTypeName: "DiscordRpc_EntryRow",
    Signals: {
      changed: { param_types: [GObject.TYPE_STRING] },
    },
  },
  class EntryRow extends St.BoxLayout {
    _init({ label, text = "", placeholder = "" } = {}) {
      super._init({ vertical: true, x_expand: true, style_class: "drpc-entry-row" });
      this._value = text;
      this._idleId = 0;

      if (label) this.add_child(new SectionLabel(label));

      this.entry = new St.Entry({
        text,
        hint_text: placeholder,
        can_focus: true,
        x_expand: true,
        style_class: "drpc-entry",
      });

      this.add_child(this.entry);
      this._wire();
    }

    _wire() {
      const text = this.entry.clutter_text;
      text.connect("notify::text", (_t) => {
        this._value = _t.get_text();
        this._scheduleEmit();
      });
      text.connect("activate", () => {
        this._flushEmit();
        return Clutter.EVENT_PROPAGATE;
      });
      this.entry.connect("key-focus-out", () => this._flushEmit());
    }

    _scheduleEmit() {
      if (this._idleId) return;
      this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
        this._idleId = 0;
        this.emit("changed", this._value ?? "");
        return GLib.SOURCE_REMOVE;
      });
    }

    _flushEmit() {
      if (this._idleId) {
        GLib.source_remove(this._idleId);
        this._idleId = 0;
      }
      this.emit("changed", this._value ?? "");
    }

    set text(value) {
      if (this._value === value || this.entry.clutter_text.has_key_focus()) return;
      this._value = value ?? "";
      if (this._idleId) {
        GLib.source_remove(this._idleId);
        this._idleId = 0;
      }
      this.entry.text = this._value;
    }

    get text() {
      return this._value ?? "";
    }

    destroy() {
      if (this._idleId) {
        GLib.source_remove(this._idleId);
        this._idleId = 0;
      }
      super.destroy();
    }
  },
);

export const TypeGrid = GObject.registerClass(
  {
    GTypeName: "DiscordRpc_TypeGrid",
    Signals: {
      selected: { param_types: [GObject.TYPE_INT] },
    },
  },
  class TypeGrid extends St.Widget {
    _init(types, columns = 3) {
      super._init({ x_expand: true, style_class: "drpc-type-grid" });
      this._buttons = [];
      const layout = new Clutter.GridLayout();
      layout.set_column_homogeneous(true);
      layout.set_row_homogeneous(true);
      layout.set_column_spacing(6);
      layout.set_row_spacing(6);
      this.layout_manager = layout;
      types.forEach((item, i) => {
        const button = this._makeButton(item);
        this.add_child(button);
        layout.attach(button, i % columns, Math.floor(i / columns), 1, 1);
      });
    }

    _makeButton(item) {
      const button = new St.Button({
        style_class: "button drpc-type-btn",
        can_focus: true,
        track_hover: true,
        x_expand: true,
        y_expand: true,
      });
      const box = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      box.add_child(
        new St.Icon({
          icon_name: item.icon,
          icon_size: 18,
          style_class: "drpc-type-icon",
        }),
      );
      box.add_child(
        new St.Label({
          text: item.label,
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
          style_class: "drpc-type-caption",
        }),
      );
      button.set_child(box);
      button.value = item.value;
      button.connect("clicked", () => this.emit("selected", item.value));
      this._buttons.push(button);
      return button;
    }

    setActive(value) {
      for (const btn of this._buttons) {
        if (btn.value === value) btn.add_style_pseudo_class("checked");
        else btn.remove_style_pseudo_class("checked");
      }
    }
  },
);

export const ActionButton = GObject.registerClass(
  { GTypeName: "DiscordRpc_ActionButton" },
  class ActionButton extends St.Button {
    _init({ label } = {}) {
      super._init({
        label,
        can_focus: true,
        x_expand: true,
        style_class: "button drpc-action",
      });
    }
  },
);

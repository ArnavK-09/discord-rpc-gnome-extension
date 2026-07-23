import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const ACTIVITY_OPTIONS = [
  { label: "Playing", value: 0 },
  { label: "Listening", value: 2 },
  { label: "Watching", value: 3 },
  { label: "Competing", value: 5 },
];

export default class DiscordRpcPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window.set_default_size(560, 720);

    const page = new Adw.PreferencesPage({
      title: "Discord RPC",
      icon_name: "applications-chat-symbolic",
    });
    window.add(page);

    page.add(this._connectionGroup(settings));
    page.add(this._presenceGroup(settings));
    page.add(this._imagesGroup(settings));
    page.add(this._behaviorGroup(settings));
  }

  _connectionGroup(settings) {
    const group = new Adw.PreferencesGroup({
      title: "Connection",
      description: "Your Discord application credentials",
    });

    group.add(this._entry(settings, "client-id", "Client ID"));

    const devRow = new Adw.ActionRow({
      title: "Open Discord Developer Portal",
      subtitle: "Create an application and copy its Client ID",
    });
    const devLink = new Gtk.LinkButton({
      label: "Open",
      uri: "https://discord.com/developers/applications",
      valign: Gtk.Align.CENTER,
    });
    devRow.add_suffix(devLink);
    devRow.activatable_widget = devLink;
    group.add(devRow);

    return group;
  }

  _presenceGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: "Presence" });

    const model = new Gtk.StringList();
    for (const opt of ACTIVITY_OPTIONS) model.append(opt.label);
    const typeRow = new Adw.ComboRow({
      title: "Activity type",
      subtitle: "How the activity appears on your profile",
      model,
    });
    const current = settings.get_int("activity-type");
    typeRow.selected = Math.max(
      0,
      ACTIVITY_OPTIONS.findIndex((o) => o.value === current),
    );
    typeRow.connect("notify::selected", () => {
      const opt = ACTIVITY_OPTIONS[typeRow.selected];
      if (opt) settings.set_int("activity-type", opt.value);
    });
    group.add(typeRow);

    group.add(this._entry(settings, "details", "Title"));
    group.add(this._entry(settings, "state", "Caption"));

    group.add(
      this._switch(
        settings,
        "show-timestamp",
        "Show elapsed time",
        "Display how long you've been active",
      ),
    );

    const resetRow = new Adw.ButtonRow({ title: "Reset timestamp" });
    resetRow.connect("activated", () => settings.set_int64("timestamp-start", Date.now()));
    group.add(resetRow);

    return group;
  }

  _imagesGroup(settings) {
    const group = new Adw.PreferencesGroup({
      title: "Assets",
      description:
        "Use an asset key uploaded in the Developer Portal (Art Assets, lowercase) or a direct image URL (https://…).",
    });
    group.add(this._entry(settings, "large-image", "Large image key"));
    group.add(this._entry(settings, "large-text", "Large image text"));
    group.add(this._entry(settings, "small-image", "Small image key"));
    group.add(this._entry(settings, "small-text", "Small image text"));
    return group;
  }

  _behaviorGroup(settings) {
    const group = new Adw.PreferencesGroup({ title: "Behavior" });
    group.add(
      this._switch(
        settings,
        "clear-on-disable",
        "Clear on disable",
        "Remove the presence immediately when turned off",
      ),
    );
    group.add(
      this._switch(
        settings,
        "only-show-when-discord-open",
        "Only show when Discord is open",
        "Hide the quick settings tile unless Discord is running",
      ),
    );
    return group;
  }

  _entry(settings, key, title) {
    const row = new Adw.EntryRow({ title });
    row.text = settings.get_string(key) ?? "";
    let timerId = 0;
    const commit = () => {
      if (timerId) {
        GLib.source_remove(timerId);
        timerId = 0;
      }
      const value = row.text ?? "";
      if (settings.get_string(key) !== value) settings.set_string(key, value);
    };
    row.connect("changed", () => {
      if (timerId) GLib.source_remove(timerId);
      timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        timerId = 0;
        commit();
        return GLib.SOURCE_REMOVE;
      });
    });
    row.connect("activate", commit);
    const focus = new Gtk.EventControllerFocus();
    row.add_controller(focus);
    focus.connect("leave", commit);
    settings.connect(`changed::${key}`, () => {
      if (settings.get_string(key) !== row.text) row.text = settings.get_string(key) ?? "";
    });
    return row;
  }

  _switch(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }
}

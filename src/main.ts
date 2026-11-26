import {
  App,
  moment as obsidianMoment,
  normalizePath,
  Notice,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  SettingDefinitionItem,
  TFile,
} from "obsidian";
import {DoneThatError, fetchTasks} from "./api";
import {buildBlock, dateStem, dayRange, parentFolders, upsertBlock} from "./format";

/** What the user can set. The API key itself is never stored here, only the name of the secret that holds it. */
interface DoneThatSettings {
  /** Name of the secret in Obsidian's secret storage that holds the API key. */
  apiKeySecret: string;
  /** Folder of the daily notes, relative to the vault. Empty for the vault's root. */
  folder: string;
  /** How a daily note's file name is formed from its date. */
  dateFormat: string;
  /** Heading put above the block when it is first added. */
  heading: string;
  /** Whether a daily note that does not exist yet is created. */
  createNote: boolean;
  /** Minutes between updates of today's note while Obsidian is open. 0 switches this off. */
  autoUpdateMinutes: number;
}

const DEFAULT_SETTINGS: DoneThatSettings = {
  apiKeySecret: "",
  folder: "",
  dateFormat: "YYYY-MM-DD",
  heading: "DoneThat",
  createNote: false,
  autoUpdateMinutes: 30,
};

/** Shortest time between two automatic updates, whatever the setting says. */
const MIN_AUTO_UPDATE_MINUTES = 5;

/**
 * The two ways the plugin calls Obsidian's Moment.js. obsidian.d.ts types `moment` as `typeof import("moment")`,
 * which loses its call signatures under esModuleInterop (TypeScript 6's default, and the community scanner's setup).
 */
interface MomentCalls {
  /** Now. */
  (): moment.Moment;
  /** A date read from text in a format; strict rejects text that does not match the format exactly. */
  (input: string, format: string, strict: boolean): moment.Moment;
}

/** Obsidian's Moment.js, typed for the calls above. */
const moment = obsidianMoment as unknown as MomentCalls;

/**
 * How each setting is cleaned up before it is stored, whichever settings screen changed it. The folder is stored as
 * typed and trimmed where it is used: Obsidian may redraw a control with the stored value, which would eat a space
 * the user is still typing.
 */
const CLEAN: {[K in keyof DoneThatSettings]: (value: DoneThatSettings[K]) => DoneThatSettings[K]} = {
  apiKeySecret: (value) => value,
  folder: (value) => value,
  dateFormat: (value) => value.trim() || DEFAULT_SETTINGS.dateFormat,
  heading: (value) => value,
  createNote: (value) => value,
  autoUpdateMinutes: (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0),
};

/** Names and descriptions of the settings, shared by the declarative tab (1.13 and later) and the drawn one. */
const LABELS: {[K in keyof DoneThatSettings]: {name: string; desc: string}} = {
  apiKeySecret: {
    name: "API key",
    desc: "Create a key in DoneThat under Settings, Integrations, API access, with the reports:read scope. It is kept in Obsidian's secret storage, not in this plugin's settings file.",
  },
  folder: {name: "Daily notes folder", desc: "Where your daily notes are, relative to the vault. Leave empty for the top level."},
  dateFormat: {name: "Date format", desc: "How your daily notes are named. Use the same format as in your daily notes settings."},
  heading: {name: "Heading", desc: "Put above the work when it is first added to a note. Leave empty for no heading."},
  createNote: {name: "Create the daily note if it is missing", desc: "When off, work is only added to a daily note that already exists."},
  autoUpdateMinutes: {
    name: "Update today's note every",
    desc: "Minutes between updates while Obsidian is open. 0 switches automatic updates off; the commands still work.",
  },
};

/** Adds the work DoneThat recorded to the daily note. */
export default class DoneThatPlugin extends Plugin {
  settings: DoneThatSettings = DEFAULT_SETTINGS;
  private timer: number | null = null;
  private running = false;

  /** Sets up the commands, the settings tab and the automatic update. */
  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new DoneThatSettingTab(this.app, this));

    this.addCommand({
      id: "add-today",
      name: "Add today's work to the daily note",
      callback: () => void this.update(moment(), true),
    });
    this.addCommand({
      id: "add-current-note",
      name: "Add the work of this note's day",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        // The date is read from the path inside the daily notes folder: the format may contain folders.
        const stem = file ? dateStem(file.path, normalizePath(this.settings.folder.trim())) : null;
        const date = stem ? moment(stem, this.settings.dateFormat, true) : null;
        if (!date || !date.isValid()) return false;
        if (!checking) void this.update(date, true);
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.schedule();
      // Once at start, quietly: the note of a day that is already under way is brought up to date.
      if (this.settings.autoUpdateMinutes > 0) void this.update(moment(), false);
    });
  }

  /** Stops the automatic update. */
  onunload(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  /** Reads the stored settings over the defaults. */
  async loadSettings(): Promise<void> {
    this.settings = {...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<DoneThatSettings> | null)};
  }

  /**
   * Cleans up and stores one changed setting.
   * @param key The setting
   * @param value Its new value, as the user entered it
   */
  async setSetting<K extends keyof DoneThatSettings>(key: K, value: DoneThatSettings[K]): Promise<void> {
    this.settings[key] = CLEAN[key](value);
    await this.saveSettings();
  }

  /** Stores the settings and applies a changed update interval. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.schedule();
  }

  /** Starts, restarts or stops the automatic update of today's note. */
  private schedule(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const minutes = this.settings.autoUpdateMinutes;
    if (!(minutes > 0)) return;
    this.timer = window.setInterval(
      () => void this.update(moment(), false),
      Math.max(MIN_AUTO_UPDATE_MINUTES, minutes) * 60 * 1000
    );
    this.registerInterval(this.timer);
  }

  /**
   * Writes one day's work into its daily note.
   * @param date The day
   * @param byHand True when the user asked for it: then problems are shown, and a missing note is said so
   */
  async update(date: moment.Moment, byHand: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const apiKey = this.settings.apiKeySecret ? this.app.secretStorage.getSecret(this.settings.apiKeySecret) : null;
      if (!apiKey) {
        if (byHand) new Notice("Add your DoneThat API key in the plugin settings first.");
        return;
      }
      const path = normalizePath(`${this.settings.folder.trim()}/${date.format(this.settings.dateFormat)}.md`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (!existing && !this.settings.createNote) {
        if (byHand) new Notice(`There is no daily note at ${path} yet.`);
        return;
      }
      if (existing && !(existing instanceof TFile)) {
        if (byHand) new Notice(`${path} is not a note.`);
        return;
      }

      const range = dayRange(date.year(), date.month() + 1, date.date());
      const rows = await fetchTasks(apiKey, range.from, range.to);
      const block = buildBlock({rows});

      let file = existing instanceof TFile ? existing : null;
      if (!file) {
        // An automatic update does not create a note for a day nothing was recorded on.
        if (!byHand && rows.length === 0) return;
        for (const folder of parentFolders(path)) {
          if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        }
        file = await this.app.vault.create(path, "");
      }
      let damaged = false;
      await this.app.vault.process(file, (note) => {
        const next = upsertBlock(note, block, this.settings.heading);
        damaged = next === null;
        return next ?? note;
      });
      if (damaged) {
        if (byHand) new Notice(`The DoneThat markers in ${path} are incomplete. Remove them, then run this again.`);
        return;
      }
      if (byHand) new Notice("Added the work DoneThat recorded.");
    } catch (error) {
      if (byHand) new Notice(error instanceof DoneThatError ? error.message : "Could not add the work from DoneThat.");
    } finally {
      this.running = false;
    }
  }
}

/**
 * The plugin's settings tab. Obsidian 1.13 and later build it from getSettingDefinitions(), which also puts the
 * settings in the settings search; older versions call display(). Both use the same labels and clean-up.
 */
class DoneThatSettingTab extends PluginSettingTab {
  /**
   * @param app The app
   * @param plugin The plugin whose settings these are
   */
  constructor(app: App, private readonly plugin: DoneThatPlugin) {
    super(app, plugin);
  }

  /** The settings for Obsidian 1.13 and later. Values are read from the plugin's settings by Obsidian. */
  getSettingDefinitions(): SettingDefinitionItem<keyof DoneThatSettings>[] {
    return [
      {...LABELS.apiKeySecret, render: (setting) => this.addApiKey(setting)},
      {...LABELS.folder, control: {type: "text", key: "folder", placeholder: "Daily"}},
      {...LABELS.dateFormat, render: (setting) => this.addDateFormat(setting)},
      {...LABELS.heading, control: {type: "text", key: "heading"}},
      {...LABELS.createNote, control: {type: "toggle", key: "createNote"}},
      {...LABELS.autoUpdateMinutes, control: {type: "number", key: "autoUpdateMinutes", min: 0, step: 1}},
    ];
  }

  /**
   * Stores a value changed through one of the controls above.
   * @param key The setting
   * @param value Its new value
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "folder":
      case "heading":
        if (typeof value === "string") await this.plugin.setSetting(key, value);
        break;
      case "createNote":
        if (typeof value === "boolean") await this.plugin.setSetting(key, value);
        break;
      case "autoUpdateMinutes":
        if (typeof value === "number") await this.plugin.setSetting(key, value);
        break;
    }
  }

  /** Draws the settings on Obsidian versions before 1.13. */
  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    const row = (labels: {name: string; desc: string}) => new Setting(containerEl).setName(labels.name).setDesc(labels.desc);

    this.addApiKey(row(LABELS.apiKeySecret));

    row(LABELS.folder).addText((text) => text
      .setPlaceholder("Daily")
      .setValue(settings.folder)
      .onChange((value) => this.plugin.setSetting("folder", value)));

    this.addDateFormat(row(LABELS.dateFormat));

    row(LABELS.heading).addText((text) => text
      .setValue(settings.heading)
      .onChange((value) => this.plugin.setSetting("heading", value)));

    row(LABELS.createNote).addToggle((toggle) => toggle
      .setValue(settings.createNote)
      .onChange((value) => this.plugin.setSetting("createNote", value)));

    row(LABELS.autoUpdateMinutes).addText((text) => text
      .setValue(String(settings.autoUpdateMinutes))
      .onChange((value) => this.plugin.setSetting("autoUpdateMinutes", Number(value))));
  }

  /**
   * Adds the picker for the secret that holds the API key.
   * @param setting The row to add it to
   */
  private addApiKey(setting: Setting): void {
    setting.addComponent((el) => new SecretComponent(this.app, el)
      .setValue(this.plugin.settings.apiKeySecret)
      .onChange((value) => this.plugin.setSetting("apiKeySecret", value ?? "")));
  }

  /**
   * Adds the date format field.
   * @param setting The row to add it to
   */
  private addDateFormat(setting: Setting): void {
    setting.addMomentFormat((format) => format
      .setDefaultFormat(DEFAULT_SETTINGS.dateFormat)
      .setValue(this.plugin.settings.dateFormat)
      .onChange((value) => this.plugin.setSetting("dateFormat", value)));
  }
}

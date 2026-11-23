import {App, moment, normalizePath, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, TFile} from "obsidian";
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
        const stem = file ? dateStem(file.path, normalizePath(this.settings.folder)) : null;
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
      const path = normalizePath(`${this.settings.folder}/${date.format(this.settings.dateFormat)}.md`);
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!file && !this.settings.createNote) {
        if (byHand) new Notice(`There is no daily note at ${path} yet.`);
        return;
      }
      if (file && !(file instanceof TFile)) {
        if (byHand) new Notice(`${path} is not a note.`);
        return;
      }

      const range = dayRange(date.year(), date.month() + 1, date.date());
      const rows = await fetchTasks(apiKey, range.from, range.to);
      const block = buildBlock({rows});

      if (!file) {
        // An automatic update does not create a note for a day nothing was recorded on.
        if (!byHand && rows.length === 0) return;
        for (const folder of parentFolders(path)) {
          if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        }
        file = await this.app.vault.create(path, "");
      }
      let damaged = false;
      await this.app.vault.process(file as TFile, (note) => {
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

/** The plugin's settings tab. */
class DoneThatSettingTab extends PluginSettingTab {
  /**
   * @param app The app
   * @param plugin The plugin whose settings these are
   */
  constructor(app: App, private readonly plugin: DoneThatPlugin) {
    super(app, plugin);
  }

  /** Draws the settings. */
  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Create a key in DoneThat under Settings, then API access, with the reports:read scope. It is kept in Obsidian's secret storage, not in this plugin's settings file.")
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(settings.apiKeySecret)
        .onChange(async (value) => {
          settings.apiKeySecret = value ?? "";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Where your daily notes are, relative to the vault. Leave empty for the top level.")
      .addText((text) => text
        .setPlaceholder("Daily")
        .setValue(settings.folder)
        .onChange(async (value) => {
          settings.folder = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Date format")
      .setDesc("How your daily notes are named. Use the same format as in your daily notes settings.")
      .addMomentFormat((format) => format
        .setDefaultFormat(DEFAULT_SETTINGS.dateFormat)
        .setValue(settings.dateFormat)
        .onChange(async (value) => {
          settings.dateFormat = value.trim() || DEFAULT_SETTINGS.dateFormat;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Heading")
      .setDesc("Put above the work when it is first added to a note. Leave empty for no heading.")
      .addText((text) => text
        .setValue(settings.heading)
        .onChange(async (value) => {
          settings.heading = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Create the daily note if it is missing")
      .setDesc("When off, work is only added to a daily note that already exists.")
      .addToggle((toggle) => toggle
        .setValue(settings.createNote)
        .onChange(async (value) => {
          settings.createNote = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Update today's note every")
      .setDesc("Minutes between updates while Obsidian is open. 0 switches automatic updates off; the commands still work.")
      .addText((text) => text
        .setValue(String(settings.autoUpdateMinutes))
        .onChange(async (value) => {
          const minutes = Number(value);
          settings.autoUpdateMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : 0;
          await this.plugin.saveSettings();
        }));
  }
}

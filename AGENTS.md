## Agents guide

Obsidian plugin that writes the work DoneThat recorded into the daily note. One-way: it reads from DoneThat's public API and writes into the vault.

- `src/format.ts`: pure logic (the Markdown block, placing it in a note). Tested in `src/format.test.ts`. Keep it free of Obsidian imports.
- `src/api.ts`: the read-only call to `https://api.donethat.ai`.
- `src/main.ts`: the plugin, its commands and its settings tab.

Rules that come from Obsidian's developer policies and must hold:

- No telemetry or analytics in the plugin.
- The API key lives in Obsidian's secret storage (`app.secretStorage`); settings hold only the secret's name.
- Any new network use, or any new data sent, is described in the README before it ships.
- The plugin only changes text between its two markers in a note.
- No Node.js or Electron APIs: the plugin also runs on mobile.

Checks: `npm run typecheck`, `npm run lint` (the Obsidian community scanner's rules, from `eslint-plugin-obsidianmd`), `npm test`, `npm run build`.

Settings: the tab has both `getSettingDefinitions()` (Obsidian 1.13 and later, and the settings search) and `display()` (older versions). Both take their names and descriptions from `LABELS` and store through `setSetting()`; change a setting in both.

Releasing: bump `version` in `manifest.json` and `package.json`, add the version to `versions.json`, then push a tag equal to the version (no `v` prefix). The release workflow attaches `main.js` and `manifest.json`.

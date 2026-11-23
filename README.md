# DoneThat for Obsidian

Adds the work [DoneThat](https://donethat.ai) recorded to your daily note: the day's total and your time per project and task.

DoneThat is a time tracker that turns your captured work into tasks on its own. This plugin brings that record into your vault, so each daily note shows what you actually did that day.

```markdown
## DoneThat
<!-- donethat:start -->
**6h 40m** recorded.

Shipped the new pricing page and cleared the support backlog.

- **Website** (4h 10m)
  - Pricing page layout (2h 30m)
  - Copy review with Sam (1h 40m)
- **Support** (2h 30m)
  - Ticket backlog (2h 30m)
<!-- donethat:end -->
```

## What you need

- **A DoneThat account.** The plugin does nothing without one.
- **An API key.** API access is part of DoneThat's Core plan and above, which is paid. Create a key in DoneThat under Settings, then API access, with the `reports:read` scope.

## Setup

1. Install and enable the plugin.
2. Open its settings and choose **API key**. Obsidian asks you to pick or create a secret; paste your DoneThat API key there. The key is kept in Obsidian's secret storage, not in the plugin's settings file.
3. Set **Daily notes folder** and **Date format** to match your daily notes.

## Using it

- **Add today's work to the daily note** (command): writes today's work into today's note.
- **Add the work of this note's day** (command): available while a daily note is open; writes that day's work into it.
- **Automatic updates:** while Obsidian is open, today's note is brought up to date every 30 minutes. Change the interval in the settings, or set it to 0 to switch this off.

The plugin only ever changes the part of a note between its two markers. Running it again replaces that part in place; everything else in the note is left as it is. If the note has no block yet, one is added at the end. If one of the two markers was deleted, or there is more than one pair, the note is left untouched and the plugin says so: remove the leftover markers and run it again.

By default the plugin adds to a daily note that already exists. Switch on **Create the daily note if it is missing** to have it create the note.

## Good to know

- A day runs from midnight to midnight in your device's time zone. If you set a later day end in DoneThat, work after midnight shows on the next day's note.
- The note shows what DoneThat's report for that day contains. Change a task in DoneThat and the next update brings the note in line.

## Network use and privacy

This plugin talks to one service: `https://api.donethat.ai`, DoneThat's own API.

- **What it sends:** your API key (in a request header) and the date it is asking about.
- **What it receives:** your recorded tasks with their durations and projects.
- **What it never sends:** your notes, their names, or anything else from your vault.

There is no telemetry and no analytics in this plugin. How DoneThat handles your data is described at [donethat.ai/privacy](https://donethat.ai/privacy).

## Support

Questions and problems: [support@donethat.ai](mailto:support@donethat.ai), or open an issue in this repository.

DoneThat is not affiliated with Obsidian.

## License

MIT. See [LICENSE](LICENSE).

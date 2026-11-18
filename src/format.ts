/**
 * Turning DoneThat's report into the block written into a daily note,
 * putting that block into a note without touching anything else in it, and
 * working out where a daily note lives.
 * Everything here is pure, so it is tested without Obsidian.
 */

/** A row of DoneThat's report at task level. Only the fields used here. */
export interface ReportRow {
  task?: string;
  duration?: number;
  project?: string;
}

/** What the block shows. */
export interface DayWork {
  rows: ReportRow[];
  /** The day's summary as plain text, when there is one. */
  summary?: string;
}

export const BLOCK_START = "<!-- donethat:start -->";
export const BLOCK_END = "<!-- donethat:end -->";

/** Name used for work that belongs to no project. */
const NO_PROJECT = "No project";

/**
 * Formats minutes as hours and minutes.
 * @param minutes Minutes; fractions are rounded
 * @return For example "45m", "2h" or "1h 5m"
 */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Keeps text from DoneThat from containing one of the block's own markers,
 * which would make the block look damaged on the next update.
 * @param text Title or summary from DoneThat
 * @return The text, with any marker written so that it is no longer one
 */
function withoutMarkers(text: string): string {
  return text.replace(/<!--(\s*donethat:)/gi, "<\\!--$1");
}

/**
 * Makes text safe to sit on one line of a Markdown list.
 * @param text Title from DoneThat
 * @return The text on one line, with a leading list or heading marker defused
 */
function oneLine(text: string): string {
  return withoutMarkers(text).replace(/\s+/g, " ").trim().replace(/^([#>\-+*]|\d+\.)\s/, "\\$1 ");
}

/**
 * Builds the Markdown block for one day: the total, the summary when there is
 * one, then projects with their tasks, longest first.
 * @param work Rows and summary of the day
 * @return The block, from its start marker to its end marker
 */
export function buildBlock(work: DayWork): string {
  const projects = new Map<string, Map<string, number>>();
  for (const row of work.rows) {
    const minutes = typeof row.duration === "number" && Number.isFinite(row.duration) ? row.duration : 0;
    const title = typeof row.task === "string" ? oneLine(row.task) : "";
    if (minutes <= 0 || !title) continue;
    const project = typeof row.project === "string" && row.project.trim() ? oneLine(row.project) : NO_PROJECT;
    const tasks = projects.get(project) ?? new Map<string, number>();
    tasks.set(title, (tasks.get(title) ?? 0) + minutes);
    projects.set(project, tasks);
  }

  const lines: string[] = [BLOCK_START];
  const total = [...projects.values()].reduce((sum, tasks) => sum + [...tasks.values()].reduce((a, b) => a + b, 0), 0);
  if (projects.size === 0) {
    lines.push("Nothing recorded for this day.");
  } else {
    lines.push(`**${formatMinutes(total)}** recorded.`);
  }
  const summary = withoutMarkers(work.summary ?? "").trim();
  if (summary) lines.push("", summary);
  if (projects.size > 0) {
    lines.push("");
    const sum = (tasks: Map<string, number>): number => [...tasks.values()].reduce((a, b) => a + b, 0);
    const ordered = [...projects.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
    for (const [project, tasks] of ordered) {
      lines.push(`- **${project}** (${formatMinutes(sum(tasks))})`);
      for (const [title, minutes] of [...tasks.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  - ${title} (${formatMinutes(minutes)})`);
      }
    }
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

/**
 * Counts how often a marker occurs in a note.
 * @param note The note's text
 * @param marker The marker
 * @return The number of occurrences
 */
function count(note: string, marker: string): number {
  return note.split(marker).length - 1;
}

/**
 * Puts the block into a note. A block that is already there is replaced in
 * place, so running this again never duplicates it and never moves it. In a
 * note without one, the block is added at the end under the heading. Nothing
 * outside the markers is changed.
 *
 * A note whose markers do not form exactly one block (one of them was deleted,
 * or there are several) is left alone: pairing a start with the wrong end would
 * delete the text between them.
 * @param note The note's text
 * @param block The block, from start marker to end marker
 * @param heading Heading to put above a new block; empty for none
 * @return The note's new text, or null when its markers are damaged and nothing may be written
 */
export function upsertBlock(note: string, block: string, heading: string): string | null {
  const starts = count(note, BLOCK_START);
  const ends = count(note, BLOCK_END);
  if (starts === 0 && ends === 0) {
    const title = heading.trim() ? `## ${heading.trim()}\n` : "";
    const gap = note.trim().length === 0 ? "" : note.endsWith("\n\n") ? "" : note.endsWith("\n") ? "\n" : "\n\n";
    return `${note}${gap}${title}${block}\n`;
  }
  const start = note.indexOf(BLOCK_START);
  const end = note.indexOf(BLOCK_END);
  if (starts !== 1 || ends !== 1 || end < start) return null;
  return note.slice(0, start) + block + note.slice(end + BLOCK_END.length);
}

/**
 * The first and one-past-last instant of a calendar day in the device's time zone.
 * @param year Full year
 * @param month Month, 1 to 12
 * @param day Day of the month
 * @return Epoch milliseconds: `from` inclusive, `to` exclusive
 */
export function dayRange(year: number, month: number, day: number): {from: number; to: number} {
  return {from: new Date(year, month - 1, day).getTime(), to: new Date(year, month - 1, day + 1).getTime()};
}

/**
 * The folders a note's path lies in, outermost first, so that each can be
 * created before the next. A date format may itself contain folders.
 * @param path Path of the note in the vault, for example "Daily/2026/11/18.md"
 * @return For example ["Daily", "Daily/2026", "Daily/2026/11"]; empty for a note at the top level
 */
export function parentFolders(path: string): string[] {
  const parts = path.split("/").filter((part) => part.length > 0).slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * The part of a daily note's path that holds its date: the path inside the
 * daily notes folder, without the extension. A date format may contain folders,
 * so the file name alone is not enough.
 * @param path Path of the note in the vault, for example "Daily/2026/11/18.md"
 * @param folder The daily notes folder; empty or "/" for the top level
 * @return For example "2026/11/18", or null when the note is not a Markdown note in that folder
 */
export function dateStem(path: string, folder: string): string | null {
  if (!path.endsWith(".md")) return null;
  const base = folder.split("/").filter((part) => part.length > 0).join("/");
  const prefix = base ? `${base}/` : "";
  if (!path.startsWith(prefix)) return null;
  const stem = path.slice(prefix.length, -".md".length);
  return stem.length > 0 ? stem : null;
}

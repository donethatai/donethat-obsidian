/**
 * Turning DoneThat's report into the block written into a daily note, and
 * putting that block into a note without touching anything else in it.
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
 * Makes text safe to sit on one line of a Markdown list.
 * @param text Title from DoneThat
 * @return The text on one line, with a leading list or heading marker defused
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/^([#>\-+*]|\d+\.)\s/, "\\$1 ");
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
  const summary = (work.summary ?? "").trim();
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
 * Puts the block into a note. A block that is already there is replaced in
 * place, so running this again never duplicates it and never moves it. In a
 * note without one, the block is added at the end under the heading. Nothing
 * outside the markers is changed.
 * @param note The note's text
 * @param block The block, from start marker to end marker
 * @param heading Heading to put above a new block; empty for none
 * @return The note's new text
 */
export function upsertBlock(note: string, block: string, heading: string): string {
  const start = note.indexOf(BLOCK_START);
  const end = start < 0 ? -1 : note.indexOf(BLOCK_END, start);
  if (start >= 0 && end >= 0) {
    return note.slice(0, start) + block + note.slice(end + BLOCK_END.length);
  }
  const title = heading.trim() ? `## ${heading.trim()}\n` : "";
  const gap = note.trim().length === 0 ? "" : note.endsWith("\n\n") ? "" : note.endsWith("\n") ? "\n" : "\n\n";
  return `${note}${gap}${title}${block}\n`;
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

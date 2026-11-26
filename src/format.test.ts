import {test} from "node:test";
import assert from "node:assert/strict";
import {BLOCK_END, BLOCK_START, buildBlock, dateStem, dayRange, formatMinutes, parentFolders, upsertBlock} from "./format";

void test("minutes are shown as hours and minutes", () => {
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(65.4), "1h 5m");
  assert.equal(formatMinutes(-3), "0m");
});

void test("the block groups tasks by project, longest first, and adds up repeats", () => {
  const block = buildBlock({
    rows: [
      {task: "Homepage copy", duration: 40, project: "Website"},
      {task: "Inbox", duration: 20},
      {task: "Footer links", duration: 90, project: "Website"},
      {task: "Homepage copy", duration: 25, project: "Website"},
      {task: "Ignored", duration: 0, project: "Website"},
    ],
  });
  assert.equal(block, [
    BLOCK_START,
    "**2h 55m** recorded.",
    "",
    "- **Website** (2h 35m)",
    "  - Footer links (1h 30m)",
    "  - Homepage copy (1h 5m)",
    "- **No project** (20m)",
    "  - Inbox (20m)",
    BLOCK_END,
  ].join("\n"));
});

void test("a title cannot break out of its list line", () => {
  const block = buildBlock({rows: [{task: "# Heading\nsecond line", duration: 10, project: "- P"}]});
  assert.ok(block.includes("- **\\- P** (10m)"));
  assert.ok(block.includes("  - \\# Heading second line (10m)"));
});

void test("a day without work says so", () => {
  assert.equal(buildBlock({rows: []}), `${BLOCK_START}\nNothing recorded for this day.\n${BLOCK_END}`);
});

void test("the block is added once, under its heading, and replaced in place afterwards", () => {
  const first = buildBlock({rows: [{task: "A", duration: 30, project: "P"}]});
  const note = "# 2026-11-18\n\nMy notes.\n";
  const added = upsertBlock(note, first, "DoneThat");
  assert.equal(added, `# 2026-11-18\n\nMy notes.\n\n## DoneThat\n${first}\n`);

  // The user writes below the block; an update changes only what is between the markers.
  assert.ok(added !== null);
  const edited = `${added}\nAfter the block.\n`;
  const second = buildBlock({rows: [{task: "A", duration: 60, project: "P"}]});
  const updated = upsertBlock(edited, second, "DoneThat");
  assert.equal(updated, `# 2026-11-18\n\nMy notes.\n\n## DoneThat\n${second}\n\nAfter the block.\n`);
  assert.ok(updated !== null);
  assert.equal(updated.split(BLOCK_START).length, 2, "there is still exactly one block");
  assert.equal(upsertBlock(updated, second, "DoneThat"), updated, "running it again changes nothing");
});

void test("an empty note gets just the block, and no heading when none is wanted", () => {
  const block = buildBlock({rows: []});
  assert.equal(upsertBlock("", block, ""), `${block}\n`);
  assert.equal(upsertBlock("", block, "Work"), `## Work\n${block}\n`);
  assert.equal(upsertBlock("text", block, ""), `text\n\n${block}\n`);
});

void test("a day runs from local midnight to the next", () => {
  const range = dayRange(2026, 11, 18);
  assert.equal(new Date(range.from).getDate(), 18);
  assert.equal(new Date(range.from).getHours(), 0);
  assert.equal(new Date(range.to).getDate(), 19);
  assert.ok(range.to - range.from >= 23 * 3600_000 && range.to - range.from <= 25 * 3600_000);
});

void test("a note whose markers are damaged is left alone, so no text of the user's is ever deleted", () => {
  const block = buildBlock({rows: [{task: "A", duration: 30, project: "P"}]});
  const added = upsertBlock("Before.\n", block, "DoneThat");
  assert.ok(added !== null);

  // The user deletes the end marker and writes below what is left of the block.
  const noEnd = `${added.replace(BLOCK_END, "")}\nMine, written later.\n`;
  assert.equal(upsertBlock(noEnd, block, "DoneThat"), null);

  // Every other shape that is not exactly one block, start before end.
  assert.equal(upsertBlock(`text\n${BLOCK_END}\n`, block, ""), null, "an end without a start");
  assert.equal(upsertBlock(`${BLOCK_END}\nmine\n${BLOCK_START}\n`, block, ""), null, "an end before its start");
  assert.equal(upsertBlock(`${BLOCK_START}\nmine\n${block}\n`, block, ""), null, "two starts");
  assert.equal(upsertBlock(`${block}\nmine\n${BLOCK_END}\n`, block, ""), null, "two ends");
  assert.equal(upsertBlock(`${block}\nmine\n${block}\n`, block, ""), null, "two blocks");
});

void test("every folder on the way to a note is listed, outermost first", () => {
  assert.deepEqual(parentFolders("2026-11-18.md"), []);
  assert.deepEqual(parentFolders("Daily/2026-11-18.md"), ["Daily"]);
  assert.deepEqual(parentFolders("Daily/2026/11/18.md"), ["Daily", "Daily/2026", "Daily/2026/11"]);
  assert.deepEqual(parentFolders("/2026/11/18.md"), ["2026", "2026/11"]);
});

void test("a daily note's date is read from its path inside the daily notes folder", () => {
  assert.equal(dateStem("Daily/2026/11/18.md", "Daily"), "2026/11/18");
  assert.equal(dateStem("Daily/2026-11-18.md", "Daily/"), "2026-11-18");
  assert.equal(dateStem("2026/11/18.md", ""), "2026/11/18");
  assert.equal(dateStem("2026-11-18.md", "/"), "2026-11-18");
  assert.equal(dateStem("Other/2026-11-18.md", "Daily"), null, "a note outside the folder");
  assert.equal(dateStem("Daily2/2026-11-18.md", "Daily"), null, "a folder that only starts the same");
  assert.equal(dateStem("Daily/2026-11-18.canvas", "Daily"), null, "not a Markdown note");
  assert.equal(dateStem("Daily/.md", "Daily"), null);
});

void test("text from DoneThat cannot put a marker inside the block", () => {
  const block = buildBlock({rows: [{task: `Fix ${BLOCK_END} bug`, duration: 10, project: BLOCK_START}]});
  assert.equal(block.split(BLOCK_START).length, 2);
  assert.equal(block.split(BLOCK_END).length, 2);
  const note = upsertBlock("", block, "");
  assert.ok(note !== null);
  assert.equal(upsertBlock(note, block, ""), note, "the next update still finds exactly one block");
});

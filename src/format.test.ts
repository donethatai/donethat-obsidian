import {test} from "node:test";
import assert from "node:assert/strict";
import {BLOCK_END, BLOCK_START, buildBlock, dayRange, formatMinutes, upsertBlock} from "./format";

test("minutes are shown as hours and minutes", () => {
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(120), "2h");
  assert.equal(formatMinutes(65.4), "1h 5m");
  assert.equal(formatMinutes(-3), "0m");
});

test("the block groups tasks by project, longest first, and adds up repeats", () => {
  const block = buildBlock({
    rows: [
      {task: "Homepage copy", duration: 40, project: "Website"},
      {task: "Inbox", duration: 20},
      {task: "Footer links", duration: 90, project: "Website"},
      {task: "Homepage copy", duration: 25, project: "Website"},
      {task: "Ignored", duration: 0, project: "Website"},
    ],
    summary: "  Shipped the new homepage.  ",
  });
  assert.equal(block, [
    BLOCK_START,
    "**2h 55m** recorded.",
    "",
    "Shipped the new homepage.",
    "",
    "- **Website** (2h 35m)",
    "  - Footer links (1h 30m)",
    "  - Homepage copy (1h 5m)",
    "- **No project** (20m)",
    "  - Inbox (20m)",
    BLOCK_END,
  ].join("\n"));
});

test("a title cannot break out of its list line", () => {
  const block = buildBlock({rows: [{task: "# Heading\nsecond line", duration: 10, project: "- P"}]});
  assert.ok(block.includes("- **\\- P** (10m)"));
  assert.ok(block.includes("  - \\# Heading second line (10m)"));
});

test("a day without work says so", () => {
  assert.equal(buildBlock({rows: []}), `${BLOCK_START}\nNothing recorded for this day.\n${BLOCK_END}`);
});

test("the block is added once, under its heading, and replaced in place afterwards", () => {
  const first = buildBlock({rows: [{task: "A", duration: 30, project: "P"}]});
  const note = "# 2026-11-18\n\nMy notes.\n";
  const added = upsertBlock(note, first, "DoneThat");
  assert.equal(added, `# 2026-11-18\n\nMy notes.\n\n## DoneThat\n${first}\n`);

  // The user writes below the block; an update changes only what is between the markers.
  const edited = `${added}\nAfter the block.\n`;
  const second = buildBlock({rows: [{task: "A", duration: 60, project: "P"}]});
  const updated = upsertBlock(edited, second, "DoneThat");
  assert.equal(updated, `# 2026-11-18\n\nMy notes.\n\n## DoneThat\n${second}\n\nAfter the block.\n`);
  assert.equal(updated.split(BLOCK_START).length, 2, "there is still exactly one block");
  assert.equal(upsertBlock(updated, second, "DoneThat"), updated, "running it again changes nothing");
});

test("an empty note gets just the block, and no heading when none is wanted", () => {
  const block = buildBlock({rows: []});
  assert.equal(upsertBlock("", block, ""), `${block}\n`);
  assert.equal(upsertBlock("", block, "Work"), `## Work\n${block}\n`);
  assert.equal(upsertBlock("text", block, ""), `text\n\n${block}\n`);
});

test("a day runs from local midnight to the next", () => {
  const range = dayRange(2026, 11, 18);
  assert.equal(new Date(range.from).getDate(), 18);
  assert.equal(new Date(range.from).getHours(), 0);
  assert.equal(new Date(range.to).getDate(), 19);
  assert.ok(range.to - range.from >= 23 * 3600_000 && range.to - range.from <= 25 * 3600_000);
});

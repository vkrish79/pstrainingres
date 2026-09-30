// Pure edits to a parent's prep_template — the list the prep setup checklist
// reads and writes. No Supabase in here, so every rule below can be run in node.
//
// An entry is { header, section_id, label?, source_workbook_id? }:
//   header     — the column a trainer fills AND the key a kit's payload stores
//                the value under. It is therefore an identity, not a caption:
//                once a kit carries it, changing it strands the value (the kit
//                still holds "EX12", the template now asks for something else,
//                and claim_prep_kit hands the old one out as a general item).
//                Nothing here ever rewrites an existing header.
//   section_id — the exercise it belongs to, or null for a general item.
//   source_workbook_id — a column drawn from another workbook's pool (composed
//                workbooks). Managed there; read-only here.
//   show_with  — GENERAL prep only (section_id null): the exercise it belongs
//                with on screen. An exercise holds one linked value per
//                participant (participant_prep is unique per section), so an
//                exercise that needs two — Refresher's Exercise 3, a PNR and an
//                EMD number — keeps the second as general prep, and this puts it
//                back beside its exercise in the drawer and the exercise itself.
//                Display only: storage and hand-out are exactly as for any
//                general prep. See lib/prepAttach.js.

import { IGNORED_HEADERS } from './prepColumns.js';

const norm = s => String(s ?? '').trim().toLowerCase();

export const MAX_HEADER_LENGTH = 40;

// Fired on window by an exercise heading's prep marker, with { sectionId }. The
// Prep template card opens (it may be collapsed) and shows that tile.
export const PREP_REVEAL_EVENT = 'prep-template-reveal';

export function isLocked(entry) {
  return !!entry?.source_workbook_id;
}

// What a tile says. "Exercise 12" -> "Ex 12", "Question 3" -> "Q3"; a title
// the author wrote in words is shown as written (the tile truncates it, and its
// tooltip carries the whole thing).
export function tileLabel(title) {
  const t = String(title ?? '').trim();
  const ex = t.match(/^(?:exercise|ex)\s*(\d+)$/i);
  if (ex) return `Ex ${ex[1]}`;
  const q = t.match(/^(?:question|q)\s*(\d+)$/i);
  if (q) return `Q${q[1]}`;
  return t || 'Untitled';
}

// The tile rows: one per topic (a workbook's section heading), each holding the
// exercises that follow it until the next heading. Exercises before the first
// heading — or all of them, where there are no headings (an assessment) — form
// a row with no topic. A heading with no exercise under it gets no row: a Cover
// or Document Information page has nothing to pick.
//
// `ordered` is the sections in document order, groups included.
export function topicRows(ordered) {
  const rows = [];
  let current = { topic: null, items: [] };
  for (const s of ordered || []) {
    if (s.kind === 'group') {
      if (current.items.length) rows.push(current);
      current = { topic: s, items: [] };
    } else {
      current.items.push(s);
    }
  }
  if (current.items.length) rows.push(current);
  return rows;
}

// Map of section id -> the column linked to it. First wins, as it does
// everywhere else a template is read: a section hosts one linked column.
export function linkedBySection(template) {
  const map = new Map();
  for (const e of template || []) {
    if (e?.section_id && !map.has(e.section_id)) map.set(e.section_id, e);
  }
  return map;
}

// A header no other column is using. Starts from the exercise's own title, so a
// new column reads "Exercise 12" with no convention to remember, and only grows
// a suffix if that name is already taken.
export function uniqueHeader(wanted, template) {
  const base = String(wanted ?? '').trim().slice(0, MAX_HEADER_LENGTH) || 'Prep item';
  const taken = new Set((template || []).map(e => norm(e.header)));
  if (!taken.has(norm(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(norm(candidate))) return candidate;
  }
}

// Why a name typed for a general item cannot be used, or '' if it can.
export function generalHeaderProblem(name, template) {
  const header = String(name ?? '').trim();
  if (!header) return 'Give the item a name.';
  if (header.length > MAX_HEADER_LENGTH) return `Keep the name to ${MAX_HEADER_LENGTH} characters or fewer.`;
  // The pool upload drops these columns unread (they are what people call the
  // "who is this row for" column), so an item named one could never be stocked.
  if (IGNORED_HEADERS.has(norm(header))) return `“${header}” is skipped when a prep sheet is uploaded — choose another name.`;
  if ((template || []).some(e => norm(e.header) === norm(header))) return `There is already a column called “${header}”.`;
  return '';
}

// Add the column for one exercise. `orderedSectionIds` is the parent's exercises
// in document order.
//
// The new column goes where the exercise sits among the columns already linked
// to exercises, and nothing else moves. Column order is what the fill sheet and
// the paste grid show, and the paste grid fills by POSITION — so re-sorting the
// whole template on every tick would silently shift what a trainer's existing
// spreadsheet lines up with.
export function addLinked(template, entry, orderedSectionIds) {
  const list = [...(template || [])];
  if (list.some(e => e.section_id === entry.section_id)) return list;
  const rank = new Map(orderedSectionIds.map((id, i) => [id, i]));
  const mine = rank.get(entry.section_id) ?? Infinity;
  let at = -1;       // index of the last linked column that comes BEFORE this exercise
  let firstLinked = -1;
  list.forEach((e, i) => {
    if (!e.section_id || !rank.has(e.section_id)) return;
    if (firstLinked === -1) firstLinked = i;
    if (rank.get(e.section_id) < mine) at = i;
  });
  // Nothing linked precedes it: lead the linked columns if there are any,
  // otherwise it is the first column of all.
  const index = at !== -1 ? at + 1 : (firstLinked !== -1 ? firstLinked : list.length);
  list.splice(index, 0, entry);
  return list;
}

export function removeEntry(template, header) {
  return (template || []).filter(e => e.header !== header);
}

// Say which exercise a general item is shown with, or none (null). Only general
// items take it: a linked column already belongs to its exercise. Clearing
// removes the key rather than storing null, so the entry says only what was
// decided.
export function setShowWith(template, header, sectionId) {
  return (template || []).map(e => {
    if (e.header !== header || e.section_id) return e;
    const { show_with: _old, ...rest } = e;
    return sectionId ? { ...rest, show_with: sectionId } : rest;
  });
}

// { [sectionId]: [entry, ...] } — general items shown with each exercise, in
// template order. Only sections in `knownIds` count: an item pointing at an
// exercise that has been deleted is plain general prep again.
export function shownWithBySection(template, knownIds) {
  const out = {};
  for (const e of template || []) {
    if (e?.section_id || !e?.show_with || !knownIds.has(e.show_with)) continue;
    (out[e.show_with] ||= []).push(e);
  }
  return out;
}

// { [header]: { available, allocated, used } } — how many kits carry a value for
// each column, split by where the kit is. Blank values do not count: a kit with
// an empty cell is not "carrying" that column.
export function countKitsByHeader(kits) {
  const out = {};
  for (const kit of kits || []) {
    const status = kit?.status;
    if (status !== 'available' && status !== 'allocated' && status !== 'used') continue;
    for (const [header, value] of Object.entries(kit.payload || {})) {
      if (!String(value ?? '').trim()) continue;
      out[header] ??= { available: 0, allocated: 0, used: 0 };
      out[header][status] += 1;
    }
  }
  return out;
}

// Kits that are still live for a column — in the pool or held by a class. Spent
// kits are history: the class has closed and its prep is already snapshotted.
export function liveKitCount(counts, header) {
  const c = counts?.[header];
  return c ? c.available + c.allocated : 0;
}

// General prep that the template says to show WITH an exercise (a template
// entry's `show_with`, see lib/prepTemplateEdit.js) — sorted out of the general
// list and onto its exercise, for every screen that shows a participant's prep.
//
// Storage is untouched: the value is still general prep (participant_prep_standalone
// for a workbook, a header in the kit payload for an assessment), keyed by the
// column header. This only decides WHERE it is shown. Pure, so node can test it.

// Template entries are keyed by MASTER section ids; a session works on a clone.
// `masterToClone` maps one to the other (sections.template_section_id). Returns
// { [cloneSectionId]: [header, ...] } in template order.
export function attachedHeadersBySection(template, masterToClone) {
  const out = {};
  for (const e of Array.isArray(template) ? template : []) {
    if (!e || e.section_id || !e.show_with || !e.header) continue;
    const clone = masterToClone instanceof Map ? masterToClone.get(e.show_with) : masterToClone?.[e.show_with];
    if (!clone) continue; // the exercise is not in this session's copy: stays general
    (out[clone] ||= []).push(e.header);
  }
  return out;
}

// Split a participant's general prep ([{ label, content, ... }]) into what goes
// with an exercise and what stays general. `attached` is attachedHeadersBySection's
// result. Returns { bySection: { [cloneSectionId]: [item...] }, general: [item...] },
// each exercise's items in template order.
export function splitGeneralPrep(standalone, attached) {
  const sectionOf = {};
  const order = {};
  for (const [sec, headers] of Object.entries(attached || {})) {
    headers.forEach((h, i) => { sectionOf[h] = sec; order[h] = i; });
  }
  const bySection = {};
  const general = [];
  for (const item of standalone || []) {
    const sec = sectionOf[item?.label];
    if (sec) (bySection[sec] ||= []).push(item);
    else general.push(item);
  }
  for (const list of Object.values(bySection)) list.sort((a, b) => order[a.label] - order[b.label]);
  return { bySection, general };
}

// What the purple prep box on one exercise holds: the exercise's own value (if
// any) followed by the general items shown with it. Each item is
// { label, content }. The label is only worth printing when there is more than
// one value — a lone value reads exactly as it always has.
//   ownLabel — the exercise's own column header, used as its label when there
//              are two or more values
export function calloutItems(ownContent, ownLabel, attachedItems) {
  const items = [];
  const own = String(ownContent ?? '').trim();
  if (own) items.push({ label: ownLabel || null, content: own });
  for (const a of attachedItems || []) {
    const v = String(a?.content ?? '').trim();
    if (v) items.push({ label: a.label, content: v });
  }
  return items;
}

// Header of the column LINKED to each master section: { [masterSectionId]: header }.
export function linkedHeaderByMasterSection(template) {
  const out = {};
  for (const e of Array.isArray(template) ? template : []) {
    if (e?.section_id && e.header && !out[e.section_id]) out[e.section_id] = e.header;
  }
  return out;
}

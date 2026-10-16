// The one order for a class list: by name, numbers counted as numbers, so
// Trainee2 comes before Trainee10. Participants are enrolled as Trainee1,
// Trainee2, … on purpose, and a trainer's own spreadsheet runs in that order,
// which is the order a paste fills rows in (report names, prep sheet) and the
// order they scan the room in. Plain localeCompare gave 1, 10, 11, …, 2.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNames(a = '', b = '') {
  return collator.compare(a || '', b || '');
}

// For objects with a full_name: list.sort(byFullName).
export function byFullName(a, b) {
  return compareNames(a?.full_name, b?.full_name);
}

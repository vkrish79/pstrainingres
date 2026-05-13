// Role tier helpers. Mirrors the DB-side helpers in
// supabase/add_vendors_and_roles.sql so the UI gates match RLS.

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  SUPER_TRAINER: 'super_trainer',
  VENDOR_MANAGER: 'vendor_manager',
  VENDOR_TRAINER: 'vendor_trainer',
  PARTICIPANT: 'participant',
};

const TRAINER_TIER = new Set([
  ROLES.SUPER_ADMIN,
  ROLES.SUPER_TRAINER,
  ROLES.VENDOR_MANAGER,
  ROLES.VENDOR_TRAINER,
  // Transitional alias: pre-migration profiles still have role='trainer'.
  // Once add_vendors_and_roles.sql is applied, no profile has this value
  // (they're all migrated to 'vendor_trainer'). Remove this entry after
  // the migration is live in prod.
  'trainer',
]);

const SUPER_TIER = new Set([ROLES.SUPER_ADMIN, ROLES.SUPER_TRAINER]);
const MANAGER_OR_ABOVE = new Set([
  ROLES.SUPER_ADMIN,
  ROLES.SUPER_TRAINER,
  ROLES.VENDOR_MANAGER,
]);

export function isTrainerTier(role) {
  return TRAINER_TIER.has(role);
}

export function isSuperAdmin(role) {
  return role === ROLES.SUPER_ADMIN;
}

export function isSuperTrainerOrAbove(role) {
  return SUPER_TIER.has(role);
}

export function isVendorManagerOrAbove(role) {
  return MANAGER_OR_ABOVE.has(role);
}

export function homePathForRole(role) {
  return isTrainerTier(role) ? '/trainer' : '/workbook';
}

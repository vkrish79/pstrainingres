import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// What uses each Settings item, for the "Used by" column and the glance row:
// programs per type, sessions per type and per city, and sessions with no
// city. Read-only, two small reads; a failure leaves the counts out rather
// than showing zeros that look real.
export function useSettingsUsage() {
  const [usage, setUsage] = useState(null);
  const load = useCallback(async () => {
    const [{ data: programs, error: e1 }, { data: sessions, error: e2 }] = await Promise.all([
      supabase.from('programs').select('id, program_type_id'),
      supabase.from('sessions').select('id, name, city_code, program_id'),
    ]);
    if (e1 || e2) { setUsage(null); return; }
    const typeOfProgram = Object.fromEntries((programs || []).map(p => [p.id, p.program_type_id]));
    const programsByType = {}, sessionsByType = {}, sessionsByCity = {};
    for (const p of programs || []) programsByType[p.program_type_id] = (programsByType[p.program_type_id] || 0) + 1;
    const noCity = [];
    for (const s of sessions || []) {
      const t = typeOfProgram[s.program_id];
      if (t) sessionsByType[t] = (sessionsByType[t] || 0) + 1;
      if (s.city_code) sessionsByCity[s.city_code] = (sessionsByCity[s.city_code] || 0) + 1;
      else noCity.push({ id: s.id, name: s.name });
    }
    setUsage({ programsByType, sessionsByType, sessionsByCity, noCity, sessionCount: (sessions || []).length });
  }, []);
  useEffect(() => { load(); }, [load]);
  return { usage, reload: load };
}

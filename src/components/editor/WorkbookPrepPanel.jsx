import { useEffect, useState } from 'react';
import { useBusyOverlay } from '../../contexts/BusyOverlayContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { useWorkbookPrep } from '../../hooks/useWorkbookPrep.js';
import ContentPrepPanel from './ContentPrepPanel.jsx';
import '../../styles/prep.css';

// Prep TEMPLATE SETUP for a master workbook. Delegates the shared template
// upload + structure list to ContentPrepPanel; layers on the composed-workbook
// extract/return flow + referenced-from tags that are workbook-only.
export default function WorkbookPrepPanel({ workbook, sections, profile }) {
  const { run: runBusy } = useBusyOverlay();
  const [sourceTitles, setSourceTitles] = useState({}); // source_workbook_id -> title
  const [extractSources, setExtractSources] = useState(null);
  const [referencedBy, setReferencedBy] = useState([]); // composed workbooks drawing this pool
  const [referenced, setReferenced] = useState([]); // entries in this workbook's prep_template that are referenced
  const [reloadKey, setReloadKey] = useState(0);
  const [nInput, setNInput] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const [extractWarn, setExtractWarn] = useState(false);
  const [returnN, setReturnN] = useState('');
  const [returning, setReturning] = useState(false);

  // This workbook's own kit pool (super partition) — drives the extracted count.
  const { balance, refresh: refreshPool } = useWorkbookPrep(workbook?.id, null);

  useEffect(() => {
    if (!workbook?.id) return;
    let cancelled = false;
    (async () => {
      let { data, error: selErr } = await supabase
        .from('workbooks').select('prep_template, prep_extract_sources').eq('id', workbook.id).single();
      // prep_extract_sources won't exist until the extraction migration is applied;
      // fall back so the prep-template display never blanks out pre-migration.
      if (selErr) {
        const r = await supabase.from('workbooks').select('prep_template').eq('id', workbook.id).single();
        data = r.data;
      }
      if (cancelled) return;
      const tpl = Array.isArray(data?.prep_template) ? data.prep_template : [];
      setReferenced(tpl.filter(c => c.source_workbook_id));
      setExtractSources(Array.isArray(data?.prep_extract_sources) ? data.prep_extract_sources : null);
      const srcIds = [...new Set([
        ...tpl.map(c => c.source_workbook_id),
        ...((Array.isArray(data?.prep_extract_sources) ? data.prep_extract_sources : []).map(c => c.source_workbook_id)),
      ].filter(Boolean))];
      if (srcIds.length) {
        const { data: wbs } = await supabase.from('workbooks').select('id, title').in('id', srcIds);
        if (!cancelled) setSourceTitles(Object.fromEntries((wbs || []).map(w => [w.id, w.title])));
      }
      // Composed workbooks that draw prep from THIS workbook's pool — so the
      // super stocks enough kits to cover their sessions too. Check both the
      // live reference (prep_template) AND extracted ones (prep_extract_sources),
      // since extraction still depletes this source on every top-up.
      const { data: allWbs } = await supabase
        .from('workbooks').select('id, title, prep_template, prep_extract_sources').eq('is_template', true);
      if (!cancelled) {
        const draws = (w) => {
          const inTpl = Array.isArray(w.prep_template) && w.prep_template.some(e => e?.source_workbook_id === workbook.id);
          const inExt = Array.isArray(w.prep_extract_sources) && w.prep_extract_sources.some(e => e?.source_workbook_id === workbook.id);
          return inTpl || inExt;
        };
        setReferencedBy((allWbs || []).filter(w => w.id !== workbook.id && draws(w)).map(w => w.title));
      }
    })();
    return () => { cancelled = true; };
  }, [workbook?.id, reloadKey]);

  // Composed workbook states: referenced (not yet extracted) vs extracted.
  const hasReferenced = referenced.length > 0;
  const isExtracted = Array.isArray(extractSources) && extractSources.length > 0;
  const showExtract = hasReferenced || isExtracted;
  const sourceNames = [...new Set(
    (isExtracted ? extractSources : referenced)
      .map(c => sourceTitles[c.source_workbook_id]).filter(Boolean),
  )];

  async function handleExtract() {
    const n = parseInt(nInput, 10);
    if (!n || n < 1) { setExtractWarn(true); setExtractMsg('Enter a participant count of 1 or more.'); return; }
    setExtracting(true); setExtractMsg(''); setExtractWarn(false);
    const { data, error: e } = await runBusy(
      'Extracting prep kits…',
      () => supabase.rpc('extract_prep_to_workbook', { p_workbook_id: workbook.id, p_count: n }),
    );
    setExtracting(false);
    if (e) { setExtractWarn(true); setExtractMsg(e.message); return; }
    const { extracted = 0, requested = n, short = false, sources = [] } = data || {};
    let msg = `Extracted ${extracted} of ${requested} participant${requested === 1 ? '' : 's'} into this workbook’s pool.`;
    if (short) {
      const dry = sources.filter(s => (s.available || 0) === extracted).map(s => `${s.title} (${s.available} available)`);
      msg += dry.length ? ` Short stock: ${dry.join(', ')}. Top up that pool and extract more.` : ' Some source pools were short.';
    }
    setExtractWarn(short || extracted === 0);
    setExtractMsg(msg);
    setNInput('');
    setReloadKey(k => k + 1);
    refreshPool?.();
  }

  async function handleReturn() {
    const avail = balance.available;
    const n = returnN.trim() ? Math.min(parseInt(returnN, 10) || 0, avail) : avail;
    if (!n || n < 1) { setExtractWarn(true); setExtractMsg('Nothing unused to return.'); return; }
    setReturning(true); setExtractMsg(''); setExtractWarn(false);
    const { data, error: e } = await runBusy(
      'Returning prep kits…',
      () => supabase.rpc('return_prep_to_pool', { p_workbook_id: workbook.id, p_count: n }),
    );
    setReturning(false);
    if (e) { setExtractWarn(true); setExtractMsg(e.message); return; }
    const { returned = 0 } = data || {};
    setExtractWarn(returned === 0);
    setExtractMsg(`Returned ${returned} unused kit${returned === 1 ? '' : 's'} to the source pool${returned === 1 ? '' : 's'}.`);
    setReturnN('');
    setReloadKey(k => k + 1);
    refreshPool?.();
  }

  const extraHeader = referencedBy.length > 0 ? (
    <p className="prep-notice">
      🔗 This workbook’s prep pool is also drawn by: <strong>{referencedBy.join(', ')}</strong>.
      Stock enough kits to cover their sessions too.
    </p>
  ) : null;

  function renderStructureItem(c, titleById) {
    return (
      <>
        <code>{c.header}</code> → {c.section_id
          ? (titleById[c.section_id] || '(exercise removed)')
          : <em>standalone (no exercise)</em>}
        {c.source_workbook_id && (
          <span className="prep-ref-tag"> · prep from {sourceTitles[c.source_workbook_id] || 'another workbook'} (managed there)</span>
        )}
      </>
    );
  }

  const extractBlock = showExtract ? (
    <div className="prep-extract">
      {!isExtracted ? (
        <>
          <p className="prep-extract-head">One-off session prep</p>
          <p className="muted">
            This workbook draws prep from{sourceNames.length ? <> <strong>{sourceNames.join(', ')}</strong></> : ' other workbooks'}.
            For a one-off session, extract a fixed number of participants’ prep into this
            workbook’s own pool — withdrawn from the source workbooks’ super pool.
          </p>
          <div className="prep-extract-row">
            <label className="form-label">Participants
              <input className="form-input compact" type="number" min="1" max="500" value={nInput}
                onChange={e => setNInput(e.target.value)} placeholder="e.g. 12" />
            </label>
            <button type="button" onClick={handleExtract} disabled={extracting || !nInput}>
              {extracting ? 'Extracting…' : 'Extract prep'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="prep-extract-head">One-off session prep</p>
          <p className="prep-notice">
            ✓ Extracted into this workbook’s own pool: <strong>{balance.available}</strong> available
            {balance.total !== balance.available ? ` · ${balance.total} total` : ''}
            {sourceNames.length ? <> · from {sourceNames.join(', ')}</> : null}.
          </p>
          <div className="prep-extract-row">
            <label className="form-label">Extract more
              <input className="form-input compact" type="number" min="1" max="500" value={nInput}
                onChange={e => setNInput(e.target.value)} placeholder="e.g. 5" />
            </label>
            <button type="button" onClick={handleExtract} disabled={extracting || !nInput}>
              {extracting ? 'Extracting…' : 'Extract more'}
            </button>
          </div>
          {balance.available > 0 && (
            <div className="prep-extract-row">
              <label className="form-label">Return unused
                <input className="form-input compact" type="number" min="1" max={balance.available} value={returnN}
                  onChange={e => setReturnN(e.target.value)} placeholder={`${balance.available} (all)`} />
              </label>
              <button type="button" className="ghost" onClick={handleReturn} disabled={returning}>
                {returning ? 'Returning…' : 'Return to pool'}
              </button>
            </div>
          )}
          <p className="muted">
            Or top up by uploading prep data directly: open the <strong>Prep</strong> tab → pick this
            workbook → upload a filled template.
          </p>
        </>
      )}
      {extractMsg && <p className={extractWarn ? 'prep-warn' : 'prep-notice'}>{extractMsg}</p>}
    </div>
  ) : null;

  return (
    <ContentPrepPanel
      parentTable="workbooks"
      parentId={workbook?.id}
      sections={sections}
      profile={profile}
      kindLabel="workbook"
      extraTemplateColumns={referenced}
      renderStructureItem={renderStructureItem}
      extraHeader={extraHeader}
      onTemplateChanged={() => setReloadKey(k => k + 1)}
    >
      {extractBlock}
    </ContentPrepPanel>
  );
}

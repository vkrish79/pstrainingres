import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import Block from '../blocks/Block.jsx';

// Read-only preview of the session's cloned assessment. Trainer-tier RLS
// (PR3) lets the trainer read assessments/sections/blocks for sessions in
// their scope. No answer entry — the assessment surface is participant-only;
// trainers see structure / questions / formatting only.
export default function TrainerAssessmentPreview({ assessmentId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assessment, setAssessment] = useState(null);
  const [sections, setSections] = useState([]);
  const [blocks, setBlocks] = useState([]);

  useEffect(() => {
    if (!assessmentId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const [{ data: ass, error: e1 }, { data: secs, error: e2 }] = await Promise.all([
        supabase.from('assessments').select('id, title, description').eq('id', assessmentId).single(),
        supabase.from('assessment_sections').select('*').eq('assessment_id', assessmentId).order('order_index'),
      ]);
      if (cancelled) return;
      if (e1 || e2) { setError((e1 || e2).message); setLoading(false); return; }
      const sectionIds = (secs || []).map(s => s.id);
      const { data: blks, error: e3 } = sectionIds.length
        ? await supabase.from('assessment_blocks').select('*').in('section_id', sectionIds).order('order_index')
        : { data: [], error: null };
      if (cancelled) return;
      if (e3) { setError(e3.message); setLoading(false); return; }
      setAssessment(ass);
      setSections(secs || []);
      setBlocks(blks || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [assessmentId]);

  if (!assessmentId) {
    return <div className="muted" style={{ padding: '1rem' }}>This session has no attached assessment.</div>;
  }
  if (loading) return <div className="loading">Loading assessment…</div>;
  if (error) return <div className="error" style={{ padding: '1rem' }}>{error}</div>;
  if (!assessment) return <div className="muted" style={{ padding: '1rem' }}>Assessment unavailable.</div>;

  return (
    <div className="trainer-assessment-preview">
      <header className="trainer-assessment-preview-head">
        <h2 style={{ margin: 0 }}>{assessment.title}</h2>
        {assessment.description && <p className="muted" style={{ marginTop: '0.25rem' }}>{assessment.description}</p>}
        <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          Read-only preview. Participants take this assessment when you unlock it.
        </p>
      </header>
      {sections.map(sec => {
        const isGroup = sec.kind === 'group';
        const secBlocks = blocks.filter(b => b.section_id === sec.id);
        return (
          <section
            key={sec.id}
            className={`wb-section${isGroup ? ' wb-section-group' : ''}`}
            data-section-id={sec.id}
          >
            {isGroup ? <h1 className="wb-section-group-title">{sec.title}</h1> : <h2>{sec.title}</h2>}
            {secBlocks.map(b => (
              <Block key={b.id} block={b} value={undefined} onChange={() => {}} readOnly />
            ))}
          </section>
        );
      })}
    </div>
  );
}

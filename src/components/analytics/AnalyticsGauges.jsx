// The headline strip, built like the session cockpit's gauges so Analytics
// reads as part of the same app. Nothing here is a call to action: the page
// reports, it does not ask for anything to be done.

import { Ring, pctText } from './marks.jsx';

function Gauge({ label, value, sub, ring }) {
  return (
    <div className="an-gauge">
      {ring !== undefined && <Ring value={ring} />}
      <div className="an-gauge-body">
        <div className="an-gauge-k">{label}</div>
        <div className="an-gauge-v">{value}</div>
        <div className="an-gauge-s">{sub}</div>
      </div>
    </div>
  );
}

export default function AnalyticsGauges({ h, compact }) {
  const a = h.assessment;
  return (
    <div className={`an-gauges${compact ? ' compact' : ''}`}>
      <Gauge
        label="Sessions"
        value={<>{h.closed}<small> closed</small></>}
        sub={h.open ? `${h.open} still open` : 'none open'}
      />
      <Gauge
        label="Trained"
        value={<>{h.people}<small> people</small></>}
        sub={h.dropouts ? `${h.dropouts} dropped out` : 'no drop-outs'}
      />
      <Gauge label="Completion" value={pctText(h.completion)} sub="weighted by class size" ring={h.completion} />
      <Gauge
        label="Pass rate"
        value={pctText(a.passRate)}
        sub={a.marked ? `${a.pass} of ${a.marked} marked papers` : 'no marked papers'}
        ring={a.passRate}
      />
      <Gauge
        label="Training days"
        value={<>{h.trainingDays}<small> days</small></>}
        sub={`${h.trainers} trainer${h.trainers === 1 ? '' : 's'} · ${h.cities} cit${h.cities === 1 ? 'y' : 'ies'}`}
      />
    </div>
  );
}

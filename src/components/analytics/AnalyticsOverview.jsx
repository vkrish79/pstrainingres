// Overview tab: three small trend lines and one Breakdown table.
//
// Three separate charts, not one chart with two y-axes. Sessions and people
// are different units; drawing them against two scales invites a comparison
// that isn't there. Each chart has one axis and one series, so no legend.

import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { monthlyRows, groupSessions, GROUPINGS, monthLabel } from '../../lib/analyticsMetrics.js';
import { Ring, Spark } from './marks.jsx';

const MIDNIGHT = '#1e3c5a';
const GOLD = '#b5985a';

function TrendCard({ title, sub, data, dataKey, domain, unit }) {
  const empty = data.every(d => d[dataKey] == null);
  return (
    <div className="an-trend">
      <div className="an-trend-t">{title}</div>
      <div className="an-trend-s">{sub}</div>
      {empty ? (
        <p className="an-muted-sm">Nothing to plot yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          {/* No negative left margin: it clips the "100" tick to "00". */}
          <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#ece8e0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7d8a97' }} tickLine={false} axisLine={{ stroke: '#ece8e0' }} />
            <YAxis
              tick={{ fontSize: 10, fill: '#7d8a97' }} tickLine={false} axisLine={false}
              allowDecimals={false} domain={domain} width={30}
            />
            <Tooltip
              formatter={v => [`${v}${unit || ''}`, title]}
              labelFormatter={k => monthLabel(data.find(d => d.label === k)?.key || '', true)}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e2dc' }}
            />
            <Line
              type="monotone" dataKey={dataKey} stroke={MIDNIGHT} strokeWidth={2}
              dot={{ r: 2.5, fill: MIDNIGHT }} activeDot={{ r: 5, fill: GOLD }} connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function AnalyticsOverview({ sessions, groupId, onGroup }) {
  const months = useMemo(() => monthlyRows(sessions), [sessions]);
  const rows = useMemo(() => groupSessions(sessions, groupId), [sessions, groupId]);
  const groupLabel = GROUPINGS.find(g => g.id === groupId)?.label || 'Type';

  const totalSessions = months.reduce((n, m) => n + m.sessions, 0);
  const totalPeople = months.reduce((n, m) => n + m.people, 0);
  const completionData = months.map(m => ({ ...m, completionRounded: m.completion == null ? null : Math.round(m.completion) }));
  // A month with no marked paper stays null so the line breaks there rather
  // than dipping to a zero nobody scored.
  const scoreData = months.map(m => ({ ...m, avgRounded: m.avgScore == null ? null : Math.round(m.avgScore) }));
  const scoredMonths = scoreData.filter(m => m.avgRounded != null).length;

  return (
    <>
      <section className="an-sec">
        <h3 className="an-sec-h">Month by month</h3>
        <div className="an-trends">
          <TrendCard
            title="Sessions closed" sub={`${totalSessions} across ${months.length} month${months.length === 1 ? '' : 's'}`}
            data={months} dataKey="sessions"
          />
          <TrendCard title="People trained" sub={`${totalPeople} in total`} data={months} dataKey="people" />
          <TrendCard
            title="Completion" sub="Average for each month, weighted by class size"
            data={completionData} dataKey="completionRounded" domain={[0, 100]} unit="%"
          />
          <TrendCard
            title="Average score"
            sub={scoredMonths ? `Papers marked in ${scoredMonths} month${scoredMonths === 1 ? '' : 's'}` : 'No marked papers yet'}
            data={scoreData} dataKey="avgRounded" domain={[0, 100]} unit="%"
          />
        </div>
      </section>

      <section className="an-sec">
        <div className="an-sec-head">
          <h3 className="an-sec-h">Breakdown</h3>
          <div className="an-seg light" role="group" aria-label="Break down by">
            {GROUPINGS.map(g => (
              <button
                key={g.id} type="button" onClick={() => onGroup(g.id)}
                aria-pressed={groupId === g.id}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="an-tscroll">
          <table className="an-table">
            <thead>
              <tr>
                <th>{groupLabel}</th>
                <th className="r">Sessions</th>
                <th className="r">People</th>
                <th>Completion</th>
                <th>Pass rate</th>
                <th className="r">Avg score</th>
                <th>Completion, session by session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const ordered = [...row.sessions].sort((a, b) => String(a.date).localeCompare(String(b.date)));
                return (
                  <tr key={row.key}>
                    <td><b>{row.name}</b></td>
                    <td className="r num">{row.closed}</td>
                    <td className="r num">{row.people}</td>
                    <td><Ring value={row.completion} size={34} /></td>
                    <td>
                      <span className="an-inline">
                        <Ring value={row.assessment.passRate} size={34} />
                        <span className="an-muted-sm num">
                          {row.assessment.marked ? `${row.assessment.pass}/${row.assessment.marked}` : 'no papers'}
                        </span>
                      </span>
                    </td>
                    <td className="r num">
                      {row.assessment.avgPct == null ? '—' : `${Math.round(row.assessment.avgPct)}%`}
                    </td>
                    <td className="an-spark-cell"><Spark values={ordered.map(s => s.completionPct)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

import React, { useEffect, useState } from 'react';
import ResponsePlot from './ResponsePlot.jsx';

async function api(path, options) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

function StateBadge({ value }) { return <span className={`badge state-${String(value || 'unknown').toLowerCase()}`}>{value || 'UNKNOWN'}</span>; }
function Score({ label, value }) { return <div className="score"><span>{label}</span><strong>{Number.isFinite(value) ? value.toFixed(1) : 'N/A'}</strong></div>; }

export default function App() {
  const [system, setSystem] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const [sys, all] = await Promise.all([api('/api/system'), api('/api/sessions')]);
      setSystem(sys); setSessions(all);
      if (active?.id) setActive(await api(`/api/sessions/${encodeURIComponent(active.id)}`));
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const source = new EventSource('/api/events');
    const handler = event => { try { setEvents(previous => [JSON.parse(event.data), ...previous].slice(0, 100)); refresh(); } catch {} };
    ['session.state-changed','measurement.completed','candidate.generated','candidate.accepted','candidate.rejected','champion.changed','operator.action-required'].forEach(type => source.addEventListener(type, handler));
    return () => source.close();
  }, [active?.id]);

  const start = async () => {
    setError('');
    try { const created = await api('/api/calibration/start', { method: 'POST', body: '{}' }); setActive(created); await refresh(); }
    catch (e) { setError(e.message); }
  };
  const command = async name => { try { setActive(await api(`/api/calibration/${encodeURIComponent(active.id)}/${name}`, { method: 'POST', body: '{}' })); await refresh(); } catch (e) { setError(e.message); } };

  const metricRows = active?.champion?.score?.components || [];
  return <main>
    <header><div><p className="eyebrow">DENON AVR-X3700H / ACM1HB</p><h1>Dynamic Theater Optimization</h1><p className="sub">Deterministic tuning with measurement evidence, not LLM-selected settings.</p></div><button className="primary" onClick={start}>START THEATER OPTIMIZATION</button></header>
    {error && <div className="error">{error}</div>}
    <section className="status-grid">
      <div className="card"><span>Product mode</span><strong>{system?.productMode || 'loading'}</strong></div>
      <div className="card"><span>Receiver writes</span><strong>{system?.receiverWritesEnabled ? 'ENABLED' : 'OFF, SAFE DEFAULT'}</strong></div>
      <div className="card"><span>Native measurement</span><strong>{active?.measurementCapability?.nativeState || system?.nativeMeasurementMode || 'unknown'}</strong></div>
      <div className="card"><span>Post-correction proof</span><strong>{active?.measurementCapability?.postCorrection ? 'AVAILABLE' : 'NOT VERIFIED'}</strong></div>
    </section>
    <section className="layout">
      <div className="panel wide">
        <div className="panel-title"><h2>Live tuning</h2><StateBadge value={active?.state} /></div>
        <div className="scores"><Score label="Baseline" value={active?.baselineScore}/><Score label="Current" value={active?.currentScore}/><Score label="Champion" value={active?.champion?.score?.value}/></div>
        <ResponsePlot plots={active?.champion?.plots || {}} />
        <p className="note">Drag across the chart to zoom, double-click to reset. Visualization does not modify the locked scoring objective.</p>
      </div>
      <aside className="panel">
        <div className="panel-title"><h2>Session</h2></div>
        {active ? <><dl><dt>ID</dt><dd>{active.id}</dd><dt>Target</dt><dd>{active.targetProfile?.name} v{active.targetProfile?.version}</dd><dt>Evidence</dt><dd>{active.audyssey ? `${active.audyssey.channels?.length || 0} channels` : 'Awaiting .ady'}</dd><dt>Mode</dt><dd>{active.productMode}</dd></dl><div className="actions"><button onClick={() => command('pause')}>Pause</button><button onClick={() => command('resume')}>Resume</button><button className="danger" onClick={() => command('abort')}>Abort</button></div></> : <p>Select or start a session.</p>}
      </aside>
    </section>
    <section className="layout">
      <div className="panel"><div className="panel-title"><h2>Component scores</h2></div>{metricRows.length ? metricRows.map(item => <div className="metric" key={item.name}><span>{item.name}</span><strong>{item.score ?? 'N/A'}</strong><small>{item.confidence || 'unknown'}</small></div>) : <p>No measured candidate score yet. Unavailable dimensions remain N/A, never fabricated.</p>}</div>
      <div className="panel wide"><div className="panel-title"><h2>Evidence and decisions</h2></div><table><thead><tr><th>#</th><th>Event</th><th>Detail</th></tr></thead><tbody>{events.filter(event => !active || event.sessionId === active.id).map(event => <tr key={`${event.sessionId}-${event.sequence}`}><td>{event.sequence}</td><td>{event.type}</td><td><code>{JSON.stringify(event.data)}</code></td></tr>)}</tbody></table></div>
    </section>
    <section className="panel"><div className="panel-title"><h2>Sessions</h2></div><div className="session-list">{sessions.map(session => <button key={session.id} className="session" onClick={async () => { setActive(await api(`/api/sessions/${encodeURIComponent(session.id)}`)); setEvents((await api(`/api/sessions/${encodeURIComponent(session.id)}/events`)).reverse()); }}><span>{session.id}</span><StateBadge value={session.state}/></button>)}</div></section>
    <footer>BEST means the highest-scoring measured candidate found inside the declared search space under the locked objective, with no safety or major-regression violations.</footer>
  </main>;
}

import React, { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const NAMES = ['Target', 'Baseline', 'Current', 'Champion'];

function normalizedData(plots = {}) {
  const source = NAMES.map(name => plots[name.toLowerCase()] || []);
  const frequencies = [...new Set(source.flatMap(points => points.map(point => Number(point?.[0])).filter(value => Number.isFinite(value) && value > 0)))].sort((a, b) => a - b);
  const series = source.map(points => {
    const map = new Map(points.map(point => [Number(point?.[0]), Number(point?.[1])]));
    return frequencies.map(frequency => Number.isFinite(map.get(frequency)) ? map.get(frequency) : null);
  });
  return [frequencies, ...series];
}

export default function ResponsePlot({ plots }) {
  const host = useRef(null);
  const data = useMemo(() => normalizedData(plots), [plots]);

  useEffect(() => {
    if (!host.current) return undefined;
    if (!data[0].length) {
      host.current.textContent = 'No response traces available yet.';
      return undefined;
    }
    host.current.textContent = '';
    const chart = new uPlot({
      width: Math.max(320, host.current.clientWidth),
      height: 360,
      scales: {
        x: { time: false, distr: 3, log: 10, range: [20, 20000] },
        y: { auto: true }
      },
      axes: [
        { label: 'Frequency (Hz)', values: (_u, ticks) => ticks.map(value => value >= 1000 ? `${value / 1000}k` : `${Math.round(value)}`) },
        { label: 'Level (dB)' }
      ],
      cursor: { drag: { x: true, y: false, setScale: true } },
      series: [
        {},
        { label: 'Target', width: 2 },
        { label: 'Baseline', width: 1.5 },
        { label: 'Current', width: 1.5 },
        { label: 'Champion', width: 2 }
      ]
    }, data, host.current);
    const reset = () => chart.setScale('x', { min: 20, max: 20000 });
    host.current.addEventListener('dblclick', reset);
    const observer = new ResizeObserver(entries => {
      const width = Math.floor(entries[0]?.contentRect?.width || 0);
      if (width > 0) chart.setSize({ width, height: 360 });
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      host.current?.removeEventListener('dblclick', reset);
      chart.destroy();
    };
  }, [data]);

  return <div className="response-plot" ref={host} aria-label="Frequency response plot" />;
}

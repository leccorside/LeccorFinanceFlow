import { useEffect, useState } from 'react';

export interface ChartColors {
  incomes: string;
  expenses: string;
  net: string;
  worth: string;
  grid: string;
  text: string;
  palette: string[];
}

function read(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const accent = value('--accent', '#3ef2ff');
  const accent2 = value('--accent-2', '#8b5cff');
  const accent3 = value('--accent-3', '#ff4fd8');
  const success = value('--success', '#5cf2a6');
  const danger = value('--danger', '#ff7a8f');
  const warning = value('--warning', '#ffc078');
  return {
    incomes: success,
    expenses: danger,
    net: accent,
    worth: accent2,
    grid: value('--border', 'rgb(120 200 255 / 14%)'),
    text: value('--text-muted', '#8299b2'),
    palette: [accent, accent2, accent3, success, warning, danger, '#7aa7ff', '#c9a0ff'],
  };
}

/** Theme colors for SVG charts, refreshed when the theme (data-theme) changes. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

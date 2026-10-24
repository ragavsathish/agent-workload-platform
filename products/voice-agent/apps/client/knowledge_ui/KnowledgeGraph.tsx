import type { ElementDefinition } from 'cytoscape';
import { useEffect, useRef } from 'react';
import './knowledge-widgets.css';

export type KnowledgeGraphEntry = {
  id: string;
  text: string;
  sourceId: string;
  sourceLabel: string;
  topics: string[];
};

export type KnowledgeGraphProps = {
  entries: KnowledgeGraphEntry[];
  selectedId?: string;
  scopeSummary?: string;
  theme?: 'dark' | 'light';
  onSelectEntry?: (entry: KnowledgeGraphEntry) => void;
  onSelectTopic?: (topic: string) => void;
  onSelectSource?: (entry: KnowledgeGraphEntry) => void;
  onReset?: () => void;
};

const mapLabel = (value: string) => value.length > 34 ? `${value.slice(0, 31).trimEnd()}…` : value;

export function KnowledgeGraph({
  entries, selectedId, scopeSummary, theme, onSelectEntry, onSelectTopic, onSelectSource, onReset,
}: KnowledgeGraphProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<import('cytoscape').Core | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const callbacksRef = useRef({ onSelectEntry, onSelectTopic, onSelectSource });
  callbacksRef.current = { onSelectEntry, onSelectTopic, onSelectSource };
  const topicLabels = [...new Set(entries.flatMap((entry) => entry.topics))].sort();

  useEffect(() => {
    if (!canvasRef.current) return;
    let disposed = false;
    let graph: import('cytoscape').Core | undefined;
    const elements: ElementDefinition[] = [];
    const sources = new Map<string, KnowledgeGraphEntry>();
    const topics = new Set<string>();
    for (const entry of entries) {
      sources.set(entry.sourceId, entry);
      elements.push({ data: { id: entry.id, label: mapLabel(entry.text), kind: 'note', entryId: entry.id } });
      elements.push({ data: { id: `edge-source-${entry.id}`, source: entry.id, target: entry.sourceId, label: 'from capture' } });
      for (const topic of entry.topics) {
        const topicId = `topic:${topic}`;
        if (!topics.has(topic)) {
          elements.push({ data: { id: topicId, label: topic, kind: 'topic', topic } });
          topics.add(topic);
        }
        elements.push({ data: { id: `edge-${entry.id}-${topic}`, source: entry.id, target: topicId, label: 'tagged' } });
      }
    }
    for (const [sourceId, entry] of sources) {
      elements.push({ data: { id: sourceId, label: entry.sourceLabel, kind: 'source', sourceId } });
    }
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (disposed || !canvasRef.current) return;
      graph = cytoscape({
        container: canvasRef.current,
        elements,
        layout: { name: 'cose', animate: false, nodeRepulsion: () => 8500, idealEdgeLength: () => 125, padding: 32 },
        minZoom: 0.25,
        maxZoom: 2,
        style: [
          { selector: 'node', style: { 'background-color': token('--pi-color-info'), label: 'data(label)', color: token('--pi-color-text'), 'font-family': 'Source Code Pro, monospace', 'font-size': 10, 'text-wrap': 'wrap', 'text-max-width': '140px', 'text-valign': 'center', 'text-halign': 'center', width: 34, height: 34, 'border-width': 2, 'border-color': token('--pi-color-canvas') } },
          { selector: 'node[kind="note"]', style: { shape: 'round-rectangle', width: 160, height: 62, 'background-color': token('--pi-color-surface-raised'), 'border-color': token('--pi-color-accent'), 'text-max-width': '138px', 'font-size': 9, padding: '8px' } },
          { selector: 'node[kind="source"]', style: { shape: 'rectangle', width: 110, height: 38, 'background-color': token('--pi-color-surface'), 'border-color': token('--pi-color-border-strong'), 'font-size': 8, 'text-max-width': '100px' } },
          { selector: 'node[kind="topic"]', style: { shape: 'hexagon', width: 100, height: 54, 'background-color': token('--pi-color-accent'), color: token('--pi-color-accent-text'), 'font-size': 9, 'text-max-width': '88px' } },
          { selector: 'edge', style: { width: 1.5, 'line-color': token('--pi-color-border-strong'), 'target-arrow-color': token('--pi-color-border-strong'), 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', color: token('--pi-color-text-muted'), 'font-size': 7, 'text-background-color': token('--pi-color-canvas'), 'text-background-opacity': 0.9, 'text-background-padding': '2px' } },
          { selector: 'node:selected', style: { 'border-width': 4, 'border-color': token('--pi-color-focus'), 'z-index': 99 } },
        ],
      });
      graphRef.current = graph;
      if (selectedIdRef.current) {
        const selected = graph.getElementById(selectedIdRef.current);
        if (selected.nonempty()) selected.select();
      }
      graph.on('tap', 'node[kind="note"]', (event) => {
        const entry = entries.find(({ id }) => id === event.target.data('entryId'));
        if (entry) callbacksRef.current.onSelectEntry?.(entry);
      });
      graph.on('tap', 'node[kind="topic"]', (event) => callbacksRef.current.onSelectTopic?.(String(event.target.data('topic'))));
      graph.on('tap', 'node[kind="source"]', (event) => {
        const entry = sources.get(String(event.target.data('sourceId')));
        if (entry) callbacksRef.current.onSelectSource?.(entry);
      });
    });
    return () => {
      disposed = true;
      graph?.destroy();
      if (graphRef.current === graph) graphRef.current = null;
    };
  }, [entries, theme]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodes().unselect();
    if (selectedId) {
      const selected = graph.getElementById(selectedId);
      if (selected.nonempty()) selected.select();
    }
  }, [entries, selectedId]);

  return <section className="knowledge-graph map-panel pi-surface" aria-label="Knowledge relationship map">
    <div className="map-heading"><div><h2>Knowledge map</h2><p>Notes · captures · topic tags</p></div><div className="map-controls">
      <button className="pi-button" type="button" aria-label="Zoom out map" title="Zoom out" onClick={() => { const graph = graphRef.current; if (graph) graph.zoom({ level: graph.zoom() / 1.25, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } }); }}>−</button>
      <button className="pi-button" type="button" aria-label="Zoom in map" title="Zoom in" onClick={() => { const graph = graphRef.current; if (graph) graph.zoom({ level: graph.zoom() * 1.25, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } }); }}>+</button>
      <button className="pi-button" type="button" onClick={() => graphRef.current?.fit(undefined, 32)}>Fit map</button>
      {onReset && <button className="pi-button map-reset" type="button" onClick={onReset}>Reset</button>}
    </div></div>
    <div className="map-legend" aria-label="Map legend"><span><i className="legend-note" /> Journal note</span><span><i className="legend-capture" /> Source capture</span><span><i className="legend-topic" /> Topic tag</span></div>
    <div className="map-canvas" ref={canvasRef} role="img" aria-label={`Relationship map with ${entries.length} journal notes. Use the journal list to navigate notes, or select a note or topic node.`} />
    <div className="map-node-list" aria-label="Keyboard accessible graph nodes">
      {entries.map((entry) => <button type="button" key={entry.id} className={selectedId === entry.id ? 'selected' : ''} aria-pressed={selectedId === entry.id} onClick={() => onSelectEntry?.(entry)}>{entry.text}</button>)}
      {topicLabels.map((topic) => <button type="button" key={`topic:${topic}`} onClick={() => onSelectTopic?.(topic)}>Topic: {topic}</button>)}
    </div>
    <div className="map-scope">Showing {entries.length} {entries.length === 1 ? 'note' : 'notes'}{scopeSummary ? ` · ${scopeSummary}` : ''} · select a topic node to filter the journal</div>
  </section>;
}

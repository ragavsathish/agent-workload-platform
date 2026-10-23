import type { ElementDefinition } from 'cytoscape';
import { useEffect, useMemo, useRef, useState } from 'react';
import { configuredOxigraphEndpoint, fetchJournalEntries, type JournalEntry } from './journal-api';

type Entry = JournalEntry;

const sampleEntries: Entry[] = [
  {
    id: 'note-memory-boundaries',
    text: 'Keep durable memory separate from accepted facts until the owner reviews it.',
    type: 'decision',
    createdAt: '2026-10-22T15:42:00Z',
    sourceId: 'capture-voice-1022',
    sourceLabel: 'Voice session · 22 Oct',
    transcript: 'I think memory should remain separate from accepted facts. Keep durable memory separate until I have reviewed it, and make the source easy to inspect.',
    topics: ['Digital twin', 'Knowledge review', 'Privacy'],
  },
  {
    id: 'note-graph-view',
    text: 'A graph view should help me discover connections without hiding the original journal note.',
    type: 'idea',
    createdAt: '2026-10-22T15:35:00Z',
    sourceId: 'capture-voice-1022',
    sourceLabel: 'Voice session · 22 Oct',
    transcript: 'For the journal, a graph could show relationships between notes. I still need to read the original note and see where it came from.',
    topics: ['Knowledge review', 'User experience'],
  },
  {
    id: 'note-local-first',
    text: 'Keep personal knowledge local and expose only bounded, read-only views to the browser.',
    type: 'decision',
    createdAt: '2026-10-19T09:18:00Z',
    sourceId: 'capture-voice-1019',
    sourceLabel: 'Voice session · 19 Oct',
    transcript: 'The digital twin is personal data. It should stay local, and a web view should only receive the small slice the person is looking at.',
    topics: ['Digital twin', 'Privacy', 'Architecture'],
  },
  {
    id: 'note-topic-tags',
    text: 'Treat extracted topics as useful tags first; add a formal taxonomy only when it has an owner.',
    type: 'thought',
    createdAt: '2026-10-18T11:06:00Z',
    sourceId: 'capture-voice-1018',
    sourceLabel: 'Voice session · 18 Oct',
    transcript: 'We can group the journal by its current topic labels. We should not pretend those labels form a hierarchy until we define one.',
    topics: ['Knowledge review', 'Ontology'],
  },
  {
    id: 'note-evidence-path',
    text: 'Every journal entry should make its originating capture easy to inspect.',
    type: 'goal',
    createdAt: '2026-10-15T16:20:00Z',
    sourceId: 'capture-voice-1015',
    sourceLabel: 'Voice session · 15 Oct',
    transcript: 'When I look at an extracted thought, I want to know which conversation it came from and be able to read the source.',
    topics: ['Digital twin', 'Provenance'],
  },
  {
    id: 'note-review-progress',
    text: 'Keep review progress stable when a note appears under more than one topic.',
    type: 'question',
    createdAt: '2026-10-14T13:12:00Z',
    sourceId: 'capture-voice-1014',
    sourceLabel: 'Voice session · 14 Oct',
    transcript: 'If a note has two tags, it should still be one note with one review state. How will the filters show that clearly?',
    topics: ['Knowledge review', 'User experience'],
  },
  {
    id: 'note-linked-views',
    text: 'Selecting a topic should keep the journal list, graph, and note details in sync.',
    type: 'idea',
    createdAt: '2026-10-12T10:30:00Z',
    sourceId: 'capture-voice-1012',
    sourceLabel: 'Voice session · 12 Oct',
    transcript: 'I want the topic list and graph and actual notes to stay connected. If I click one, the other view should make it clear what I am looking at.',
    topics: ['User experience', 'Knowledge review'],
  },
];

const dateLabel = (value: string) => new Intl.DateTimeFormat('en', {
  day: 'numeric', month: 'short', year: 'numeric',
}).format(new Date(value));

const timeLabel = (value: string) => new Intl.DateTimeFormat('en', {
  hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

const dateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-');
};

const dateGroupLabel = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  const today = new Date();
  const todayKey = dateKey(today);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === todayKey) return 'Today';
  if (key === dateKey(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};

const noteTypes = ['decision', 'idea', 'thought', 'goal', 'question', 'learning'];
const dateRanges = [
  { value: 'any', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
] as const;

const mapLabel = (text: string) => text.length > 34 ? `${text.slice(0, 31).trimEnd()}…` : text;

export const KnowledgeBaseView = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mode, setMode] = useState<'journal' | 'map'>('journal');
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<(typeof dateRanges)[number]['value']>('any');
  const [topicQuery, setTopicQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>(sampleEntries);
  const [connection, setConnection] = useState<'sample' | 'loading' | 'live' | 'error'>(
    configuredOxigraphEndpoint() ? 'loading' : 'sample',
  );
  const [connectionMessage, setConnectionMessage] = useState('');
  const [selectedId, setSelectedId] = useState(sampleEntries[0]?.id ?? '');
  const [notice, setNotice] = useState('');
  const graphRef = useRef<HTMLDivElement>(null);
  const entryListRef = useRef<HTMLDivElement>(null);
  const graphInstanceRef = useRef<import('cytoscape').Core | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const listScrollTopRef = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const endpoint = configuredOxigraphEndpoint();
    if (!endpoint) return;
    const controller = new AbortController();
    setConnection('loading');
    void fetchJournalEntries(endpoint, controller.signal).then((liveEntries) => {
      setEntries(liveEntries);
      setConnection('live');
      setConnectionMessage('');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setEntries([]);
      setConnection('error');
      setConnectionMessage(error instanceof Error ? error.message : 'Could not load the journal.');
    });
    return () => controller.abort();
  }, []);

  const topicCounts = useMemo(() => entries.reduce<Record<string, number>>((counts, entry) => {
    for (const topic of entry.topics) counts[topic] = (counts[topic] ?? 0) + 1;
    return counts;
  }, {}), [entries]);
  const topics = Object.entries(topicCounts).sort(([left], [right]) => left.localeCompare(right));

  const activeFilters = [
    ...(selectedType !== 'all' ? [{ key: 'type', label: `Type: ${selectedType[0]!.toUpperCase()}${selectedType.slice(1)}` }] : []),
    ...selectedTopics.map((topic) => ({ key: `topic:${topic}`, label: `Topic: ${topic}` })),
    ...(dateRange !== 'any' ? [{ key: 'date', label: `Date: ${dateRanges.find(({ value }) => value === dateRange)?.label}` }] : []),
  ];
  const activeFilterCount = activeFilters.length;

  const sortedEntries = useMemo(() => [...entries].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  ), [entries]);

  const filteredEntries = useMemo(() => sortedEntries.filter((entry) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || [entry.text, entry.transcript, entry.sourceLabel, ...entry.topics]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
    const matchesTopics = selectedTopics.length === 0
      || selectedTopics.some((topic) => entry.topics.includes(topic));
    const createdAt = new Date(entry.createdAt);
    const now = new Date();
    const matchesDate = dateRange === 'any'
      || (dateRange === 'year' && createdAt.getFullYear() === now.getFullYear())
      || (dateRange === '7d' && createdAt.getTime() >= now.getTime() - 7 * 24 * 60 * 60 * 1000)
      || (dateRange === '30d' && createdAt.getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return matchesQuery && matchesTopics && matchesDate
      && (selectedType === 'all' || entry.type === selectedType);
  }), [dateRange, query, selectedTopics, selectedType, sortedEntries]);

  const dateGroups = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of filteredEntries) {
      const key = dateKey(entry.createdAt);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [filteredEntries]);

  const visibleTopics = topics.filter(([topic]) => topic.toLowerCase().includes(topicQuery.trim().toLowerCase()));
  const scopeSummary = [
    query.trim() ? `Search: “${query.trim()}”` : '',
    ...activeFilters.map(({ label }) => label),
  ].filter(Boolean).join(' · ');

  const selectedEntry = filteredEntries.find(({ id }) => id === selectedId)
    ?? filteredEntries[0]
    ?? null;

  useEffect(() => {
    if (filteredEntries.length > 0 && !filteredEntries.some(({ id }) => id === selectedId)) {
      setSelectedId(filteredEntries[0]!.id);
    }
  }, [filteredEntries, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && filtersOpen) {
        setFiltersOpen(false);
        filterButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filtersOpen]);

  useEffect(() => {
    if (mode === 'journal' && entryListRef.current) {
      entryListRef.current.scrollTop = listScrollTopRef.current;
    }
  }, [mode]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterPopoverRef.current?.contains(event.target)) {
        setFiltersOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [filtersOpen]);

  useEffect(() => {
    document.documentElement.dataset.piTheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content', getComputedStyle(document.documentElement).getPropertyValue('--pi-color-canvas').trim(),
    );
  }, [theme]);

  useEffect(() => {
    if (mode !== 'map' || !graphRef.current) return;
    let destroyed = false;
    let graph: import('cytoscape').Core | undefined;
    const visibleSources = new Map<string, Entry>();
    const visibleTopics = new Set<string>();
    for (const entry of filteredEntries) {
      visibleSources.set(entry.sourceId, entry);
      for (const topic of entry.topics) visibleTopics.add(topic);
    }
    const elements: ElementDefinition[] = [];
    const addedTopics = new Set<string>();
    for (const entry of filteredEntries) {
      elements.push({ data: { id: entry.id, label: mapLabel(entry.text), kind: 'note', entryId: entry.id } });
      elements.push({ data: { id: `edge-source-${entry.id}`, source: entry.id, target: entry.sourceId, label: 'from capture' } });
      for (const topic of entry.topics) {
        const topicId = `topic:${topic}`;
        if (!visibleTopics.has(topic)) continue;
        if (!addedTopics.has(topic)) {
          elements.push({ data: { id: topicId, label: topic, kind: 'topic', topic } });
          addedTopics.add(topic);
        }
        elements.push({ data: { id: `edge-${entry.id}-${topic}`, source: entry.id, target: topicId, label: 'tagged' } });
      }
    }
    for (const [sourceId, entry] of visibleSources) {
      elements.push({ data: { id: sourceId, label: entry.sourceLabel, kind: 'source', sourceId } });
    }
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    void import('cytoscape').then(({ default: cytoscape }) => {
      if (destroyed || !graphRef.current) return;
      graph = cytoscape({
      container: graphRef.current,
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
      graphInstanceRef.current = graph;
      const selectedNode = graph.getElementById(selectedIdRef.current);
      if (selectedNode.nonempty()) selectedNode.select();
      graph.on('tap', 'node[kind="note"]', (event) => {
      const id = String(event.target.data('entryId'));
      setSelectedId(id);
      setNotice(`Selected journal note: ${event.target.data('label')}`);
      });
      graph.on('tap', 'node[kind="topic"]', (event) => {
      selectTopic(String(event.target.data('topic')));
      setMode('journal');
      setNotice(`Showing notes tagged ${event.target.data('topic')}`);
      });
      graph.on('tap', 'node[kind="source"]', (event) => {
      const sourceId = String(event.target.data('sourceId'));
      const sourceEntry = filteredEntries.find(({ sourceId: id }) => id === sourceId);
      if (sourceEntry) setSelectedId(sourceEntry.id);
      setSelectedTopics([]);
      setSelectedType('all');
      setDateRange('any');
      setQuery(String(event.target.data('label')));
      setMode('journal');
      setNotice(`Showing journal notes from ${event.target.data('label')}`);
      });
    });
    return () => {
      destroyed = true;
      graph?.destroy();
      if (graphInstanceRef.current === graph) graphInstanceRef.current = null;
    };
  }, [filteredEntries, mode, theme]);

  useEffect(() => {
    const graph = graphInstanceRef.current;
    if (!graph || mode !== 'map') return;
    graph.nodes().unselect();
    const selected = graph.getElementById(selectedId);
    if (selected.nonempty()) selected.select();
  }, [filteredEntries, mode, selectedId]);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((current) => current.includes(topic)
      ? current.filter((value) => value !== topic)
      : [...current, topic]);
  };

  const clearFilters = () => {
    setSelectedType('all');
    setSelectedTopics([]);
    setDateRange('any');
    setTopicQuery('');
    setNotice('All journal filters cleared');
  };

  const clearAll = () => {
    setQuery('');
    clearFilters();
  };

  const removeFilter = (key: string) => {
    if (key === 'type') setSelectedType('all');
    else if (key === 'date') setDateRange('any');
    else if (key.startsWith('topic:')) {
      const topic = key.slice('topic:'.length);
      setSelectedTopics((current) => current.filter((value) => value !== topic));
    }
    setNotice('Journal filter removed');
  };

  const selectTopic = (topic: string) => {
    setSelectedTopics((current) => current.includes(topic) ? current : [...current, topic]);
    setMode('journal');
    setNotice(`Showing notes tagged ${topic}`);
  };

  const chooseEntry = (entry: Entry) => {
    setSelectedId(entry.id);
    setNotice(`Selected journal note from ${dateLabel(entry.createdAt)}`);
  };

  return (
    <main className="knowledge-page">
      <header className="knowledge-topbar pi-app-header">
        <a className="knowledge-brand pi-app-header__identity" href="/" aria-label="Pi Voice home">
          <span className="knowledge-brand-mark pi-app-header__mark">P</span>
          <span>PI / KNOWLEDGE</span>
        </a>
        <div className="knowledge-top-actions pi-app-header__actions">
          <nav className="pi-app-header__nav" aria-label="Primary navigation">
            <a href="/diagnostics/" aria-label="Input diagnostics"><span className="pi-icon" data-pi-icon="audio" aria-hidden="true" />Input diagnostics</a>
          </nav>
          <span className="local-state"><span aria-hidden="true" />{connection === 'live' ? 'Live Oxigraph' : connection === 'loading' ? 'Connecting…' : connection === 'error' ? 'Connection error' : 'Sample data'}</span>
          <button className="pi-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <span className="pi-icon" data-pi-icon={theme === 'dark' ? 'theme-light' : 'theme-dark'} aria-hidden="true" />{theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <section className="knowledge-heading">
        <div>
          <p className="pi-kicker">DIGITAL TWIN · JOURNAL</p>
          <h1>Journal &amp; knowledge</h1>
          <p className="knowledge-subtitle">Browse personal notes, follow their source, and explore the topics that connect them.</p>
        </div>
        <div className="knowledge-stat" aria-label={`${filteredEntries.length} notes shown`}>
          <strong>{filteredEntries.length.toString().padStart(2, '0')}</strong>
          <span>NOTES SHOWN</span>
        </div>
      </section>

      {connection !== 'live' && <div className="sample-banner" role={connection === 'error' ? 'alert' : 'note'}>
        <span className="sample-dot" aria-hidden="true" />
        <span>{connection === 'sample'
          ? <><strong>Preview workspace</strong> · Illustrative entries. Set <code>VITE_OXIGRAPH_QUERY_URL</code> to connect.</>
          : connection === 'loading'
            ? <><strong>Connecting to Oxigraph</strong> · Loading the journal from the configured endpoint.</>
            : <><strong>Oxigraph unavailable</strong> · {connectionMessage}</>}</span>
      </div>}

      <section className="knowledge-toolbar" aria-label="Journal controls">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <span className="visually-hidden">Search journal</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, sources, topics…" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="filter-popover" ref={filterPopoverRef}>
          <button
            className={`pi-button filter-trigger ${filtersOpen ? 'open' : ''}`}
            type="button"
            ref={filterButtonRef}
            aria-expanded={filtersOpen}
            aria-controls="journal-filter-menu"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span aria-hidden="true">☷</span> Filter
            {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
          </button>
          {filtersOpen && <div className="filter-menu" id="journal-filter-menu" role="group" aria-label="Journal filters">
            <fieldset className="filter-group">
              <legend>Type</legend>
              <label className="filter-option"><input type="radio" name="note-type" value="all" checked={selectedType === 'all'} onChange={() => setSelectedType('all')} /><span>All types</span></label>
              {noteTypes.map((type) => <label className="filter-option" key={type}>
                <input type="radio" name="note-type" value={type} checked={selectedType === type} onChange={() => setSelectedType(type)} />
                <span>{type[0]!.toUpperCase() + type.slice(1)}</span>
              </label>)}
            </fieldset>
            <fieldset className="filter-group">
              <legend>Topic</legend>
              {topics.length > 8 && <label className="topic-search">
                <span className="visually-hidden">Search topics</span>
                <input value={topicQuery} onChange={(event) => setTopicQuery(event.target.value)} placeholder="Find a topic…" />
              </label>}
              <div className="filter-options-scroll">
                {visibleTopics.length === 0 && <p className="filter-empty">No topics match.</p>}
                {visibleTopics.map(([topic, count]) => <label className="filter-option" key={topic}>
                  <input type="checkbox" checked={selectedTopics.includes(topic)} onChange={() => toggleTopic(topic)} />
                  <span>{topic}</span><small>{count}</small>
                </label>)}
              </div>
            </fieldset>
            <fieldset className="filter-group">
              <legend>Date</legend>
              {dateRanges.map(({ value, label }) => <label className="filter-option" key={value}>
                <input type="radio" name="date-range" value={value} checked={dateRange === value} onChange={() => setDateRange(value)} />
                <span>{label}</span>
              </label>)}
            </fieldset>
            {activeFilterCount > 0 && <button className="filter-clear" type="button" onClick={clearFilters}>Clear filters</button>}
          </div>}
        </div>
        <div className="view-switch" role="group" aria-label="Knowledge view">
          <button type="button" className={mode === 'journal' ? 'active' : ''} aria-pressed={mode === 'journal'} onClick={() => setMode('journal')}><span aria-hidden="true">☷</span> Journal</button>
          <button type="button" className={mode === 'map' ? 'active' : ''} aria-pressed={mode === 'map'} onClick={() => setMode('map')}><span aria-hidden="true">⠿</span> Map</button>
        </div>
      </section>

      {activeFilterCount > 0 && <section className="active-filters" aria-label="Active filters" role="region">
        <span className="active-filters-label">FILTERED BY</span>
        {activeFilters.map(({ key, label }) => <button className="active-filter-chip" type="button" key={key} onClick={() => removeFilter(key)} aria-label={`Remove ${label} filter`}>
          {label}<span aria-hidden="true">×</span>
        </button>)}
        <button className="clear-all-filters" type="button" onClick={clearFilters}>Clear all</button>
      </section>}

      <section className={`knowledge-workspace ${mode === 'map' ? 'map-mode' : ''}`}>
        {mode === 'journal' ? (
          <section className="entry-list-panel pi-surface" aria-label="Journal note list">
            <div className="panel-toolbar">
              <div><h2>{selectedTopics.length === 1 ? selectedTopics[0] : 'All notes'}</h2><p>{filteredEntries.length} {filteredEntries.length === 1 ? 'note' : 'notes'} · newest first</p></div>
              <span className="sort-label">{dateGroups.length} {dateGroups.length === 1 ? 'DAY' : 'DAYS'}</span>
            </div>
            <div className="entry-list" ref={entryListRef} role="list" onScroll={(event) => { listScrollTopRef.current = event.currentTarget.scrollTop; }}>
              {dateGroups.map(([key, groupEntries]) => <section className="date-group" key={key} aria-labelledby={`date-${key}`}>
                <div className="date-heading"><h3 id={`date-${key}`}>{dateGroupLabel(key)}</h3><span>{groupEntries.length}</span></div>
                {groupEntries.map((entry) => (
                  <div role="listitem" key={entry.id}>
                    <button type="button" className={`entry-card ${selectedEntry?.id === entry.id ? 'selected' : ''}`} onClick={() => chooseEntry(entry)} aria-pressed={selectedEntry?.id === entry.id}>
                      <div className="entry-meta"><span className={`type-mark type-${entry.type}`} aria-hidden="true" /> <span>{entry.type}</span><time dateTime={entry.createdAt}>{timeLabel(entry.createdAt)}</time></div>
                      <span className="entry-text">{entry.text}</span>
                      <span className="entry-tags">{entry.topics.slice(0, 2).map((topic) => <span className="tag-chip" key={topic}>{topic}</span>)}{entry.topics.length > 2 && <span className="tag-overflow">+{entry.topics.length - 2}</span>}</span>
                    </button>
                  </div>
                ))}
              </section>)}
              {filteredEntries.length === 0 && <div className="pi-empty-state"><strong>No notes match</strong><span>Try another search or remove a filter.</span><button className="pi-button" type="button" onClick={clearAll}>Clear search and filters</button></div>}
            </div>
          </section>
        ) : (
          <section className="map-panel pi-surface" aria-label="Knowledge relationship map">
            <div className="map-heading"><div><h2>Knowledge map</h2><p>Notes · captures · topic tags</p></div><div className="map-controls"><button className="pi-button" type="button" aria-label="Zoom out map" title="Zoom out" onClick={() => { const graph = graphInstanceRef.current; if (graph) graph.zoom({ level: graph.zoom() / 1.25, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } }); }}>−</button><button className="pi-button" type="button" aria-label="Zoom in map" title="Zoom in" onClick={() => { const graph = graphInstanceRef.current; if (graph) graph.zoom({ level: graph.zoom() * 1.25, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } }); }}>+</button><button className="pi-button" type="button" onClick={() => graphInstanceRef.current?.fit(undefined, 32)}>Fit map</button><button className="pi-button map-reset" type="button" onClick={clearAll}>Reset</button></div></div>
            <div className="map-legend" aria-label="Map legend"><span><i className="legend-note" /> Journal note</span><span><i className="legend-capture" /> Source capture</span><span><i className="legend-topic" /> Topic tag</span></div>
            <div className="map-canvas" ref={graphRef} role="img" aria-label={`Relationship map with ${filteredEntries.length} journal notes. Use the journal list to navigate notes, or select a note or topic node.`} />
            <div className="map-node-list" aria-label="Keyboard accessible journal notes">
              {filteredEntries.map((entry) => <button type="button" key={entry.id} className={selectedEntry?.id === entry.id ? 'selected' : ''} aria-pressed={selectedEntry?.id === entry.id} onClick={() => chooseEntry(entry)}>{entry.text}</button>)}
            </div>
            <div className="map-scope">Showing {filteredEntries.length} {filteredEntries.length === 1 ? 'note' : 'notes'}{scopeSummary ? ` · ${scopeSummary}` : ''} · select a topic node to filter the journal</div>
          </section>
        )}

        <aside className="entry-detail pi-surface" aria-label="Selected journal note">
          {selectedEntry ? (
            <>
              <div className="detail-head"><div className="detail-icon" aria-hidden="true">✳</div><div><p className="pi-kicker">JOURNAL NOTE</p><span>{selectedEntry.type.toUpperCase()}</span></div></div>
              <h2>{selectedEntry.text}</h2>
              <div className="detail-date"><span aria-hidden="true">◷</span> Captured {dateLabel(selectedEntry.createdAt)}</div>
              <div className="detail-section"><h3>TOPIC TAGS</h3><div className="detail-tags">{selectedEntry.topics.map((topic) => <button key={topic} type="button" className="tag-chip clickable" onClick={() => selectTopic(topic)}>{topic}</button>)}</div></div>
              <div className="detail-section source-section"><div className="section-title-row"><h3>SOURCE CAPTURE</h3><span className="source-badge">LINKED</span></div><div className="source-link"><span className="capture-icon" aria-hidden="true">▤</span><span><strong>{selectedEntry.sourceLabel}</strong><small>Original conversation</small></span></div><blockquote>{selectedEntry.transcript}</blockquote><p className="source-note">Source transcript is shown for context. No exact evidence span is stored for this preview.</p></div>
              <div className="detail-footer"><span className="read-only-mark" aria-hidden="true">◉</span><span>Read-only knowledge view</span></div>
            </>
          ) : (
            <div className="pi-empty-state"><strong>Select a journal note</strong><span>Its source and topic connections will appear here.</span></div>
          )}
        </aside>
      </section>

      <p className="knowledge-status" aria-live="polite">{notice}</p>
      <footer className="knowledge-footer"><span>PI / PRIVATE DIGITAL TWIN</span><span>Read-only journal view · {connection === 'live' ? 'Oxigraph' : 'preview data'}</span></footer>
    </main>
  );
};

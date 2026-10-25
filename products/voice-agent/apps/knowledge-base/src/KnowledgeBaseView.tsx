import { useEffect, useMemo, useRef, useState } from 'react';
import { configuredOxigraphEndpoint, fetchAssertionReview, fetchJournalEntries, saveAssertionReview, saveJournalFeedback, type JournalEntry } from './journal-api';
import { KnowledgeGraph } from '../../client/knowledge_ui/KnowledgeGraph';
import { KnowledgeNoteCard } from '../../client/knowledge_ui/KnowledgeNoteCard';
import { JournalCorrectionForm, JOURNAL_TYPES, type JournalCorrection } from '../../client/knowledge_ui/JournalCorrectionForm';
import { SourceCapture } from '../../client/knowledge_ui/SourceCapture';

type Entry = JournalEntry;
type ReviewDraft = { entryId: string; text: string; type: Entry['type']; topics: string };
type AssertionKind = 'none' | 'conversation_topic' | 'skill_evidence' | 'profile_update';
type ProfileField = 'none' | 'job_title' | 'home_location' | 'credential' | 'employment';
type AssertionDraft = { entryId: string; ownerAuthored: 'unknown' | 'yes' | 'no'; kind: AssertionKind | ''; profileField: ProfileField; reason: string };
type AssertionPreview = Omit<AssertionDraft, 'entryId'>;

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

const noteTypes = JOURNAL_TYPES;
const dateRanges = [
  { value: 'any', label: 'Any time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
] as const;

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
  const [previewEdits, setPreviewEdits] = useState<Record<string, Pick<Entry, 'text' | 'type' | 'topics'>>>({});
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | null>(null);
  const [assertionDraft, setAssertionDraft] = useState<AssertionDraft | null>(null);
  const [assertionPreviews, setAssertionPreviews] = useState<Record<string, AssertionPreview>>({});
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [lastRemovedId, setLastRemovedId] = useState<string | null>(null);
  const [connection, setConnection] = useState<'sample' | 'loading' | 'live' | 'error'>(
    configuredOxigraphEndpoint() ? 'loading' : 'sample',
  );
  const [connectionMessage, setConnectionMessage] = useState('');
  const [selectedId, setSelectedId] = useState(sampleEntries[0]?.id ?? '');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const entryListRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const listScrollTopRef = useRef(0);

  useEffect(() => {
    const endpoint = configuredOxigraphEndpoint();
    if (!endpoint) return;
    const controller = new AbortController();
    setConnection('loading');
    void fetchJournalEntries(endpoint, controller.signal).then((liveEntries) => {
      setEntries(liveEntries);
      setPreviewEdits({});
      setHiddenIds([]);
      setReviewDraft(null);
      setAssertionDraft(null);
      setAssertionPreviews({});
      setLastRemovedId(null);
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

  const visibleEntries = useMemo(() => entries
    .filter((entry) => !hiddenIds.includes(entry.id))
    .map((entry) => ({ ...entry, ...previewEdits[entry.id] })), [entries, hiddenIds, previewEdits]);

  const topicCounts = useMemo(() => visibleEntries.reduce<Record<string, number>>((counts, entry) => {
    for (const topic of entry.topics) counts[topic] = (counts[topic] ?? 0) + 1;
    return counts;
  }, {}), [visibleEntries]);
  const topics = Object.entries(topicCounts).sort(([left], [right]) => left.localeCompare(right));

  const activeFilters = [
    ...(selectedType !== 'all' ? [{ key: 'type', label: `Type: ${selectedType[0]!.toUpperCase()}${selectedType.slice(1)}` }] : []),
    ...selectedTopics.map((topic) => ({ key: `topic:${topic}`, label: `Topic: ${topic}` })),
    ...(dateRange !== 'any' ? [{ key: 'date', label: `Date: ${dateRanges.find(({ value }) => value === dateRange)?.label}` }] : []),
  ];
  const activeFilterCount = activeFilters.length;

  const sortedEntries = useMemo(() => [...visibleEntries].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  ), [visibleEntries]);

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
    setReviewDraft(null);
    setAssertionDraft(null);
    setRemoveConfirmId(null);
    setNotice(`Selected journal note from ${dateLabel(entry.createdAt)}`);
  };

  const startReview = (entry: Entry) => {
    setRemoveConfirmId(null);
    setAssertionDraft(null);
    setReviewDraft({ entryId: entry.id, text: entry.text, type: entry.type, topics: entry.topics.join(', ') });
  };

  const startAssertionReview = (entry: Entry) => {
    setReviewDraft(null);
    setRemoveConfirmId(null);
    setAssertionDraft({ entryId: entry.id, ownerAuthored: 'unknown', kind: '', profileField: 'none', reason: '' });
  };

  useEffect(() => {
    if (connection !== 'live' || !selectedId || !entries.some(({ id }) => id === selectedId)) return;
    let active = true;
    void fetchAssertionReview(selectedId).then((review) => {
      if (!active || !review) return;
      setAssertionPreviews((current) => ({ ...current, [selectedId]: {
        ownerAuthored: review.ownerAuthored ? 'yes' : 'no',
        kind: (review.expectedKind ?? '') as AssertionKind | '',
        profileField: (review.expectedProfileField ?? 'none') as ProfileField,
        reason: review.reason,
      } }));
    }).catch(() => { /* A missing review or read failure does not block journal browsing. */ });
    return () => { active = false; };
  }, [connection, entries, selectedId]);

  const reloadSavedJournal = async () => {
    const endpoint = configuredOxigraphEndpoint();
    if (!endpoint) throw new Error('Oxigraph query endpoint is not configured.');
    setEntries(await fetchJournalEntries(endpoint));
  };

  const applyAssertionPreview = async () => {
    if (!assertionDraft || assertionDraft.ownerAuthored === 'unknown' || !assertionDraft.reason.trim()
      || (assertionDraft.ownerAuthored === 'yes' && !assertionDraft.kind)
      || (assertionDraft.kind === 'profile_update' && assertionDraft.profileField === 'none')) return;
    const { entryId, ...preview } = assertionDraft;
    if (connection === 'live') {
      setSaving(true);
      try {
        await saveAssertionReview(entryId, {
          ownerAuthored: preview.ownerAuthored === 'yes',
          ...(preview.ownerAuthored === 'yes' ? { expectedKind: preview.kind, expectedProfileField: preview.profileField } : {}),
          reason: preview.reason,
        });
        const saved = await fetchAssertionReview(entryId);
        if (!saved) throw new Error('Saved assertion review could not be read back.');
        setAssertionPreviews((current) => ({ ...current, [entryId]: preview }));
        setAssertionDraft(null);
        setNotice('Assertion review saved separately from accepted personal facts.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save assertion review.'); }
      finally { setSaving(false); }
      return;
    }
    setAssertionPreviews((current) => ({ ...current, [entryId]: preview }));
    setAssertionDraft(null);
    setNotice('Assertion review preview updated. No training label has been saved.');
  };

  const applyReviewPreview = async (correction: JournalCorrection) => {
    if (!reviewDraft) return;
    const { text, type, topics } = correction;
    if (connection === 'live') {
      setSaving(true);
      try {
        await saveJournalFeedback(reviewDraft.entryId, { action: 'edit', correctedText: text, correctedType: type, correctedTopics: topics });
        await reloadSavedJournal();
        setReviewDraft(null);
        setNotice('Journal correction saved to Oxigraph.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save journal correction.'); }
      finally { setSaving(false); }
      return;
    }
    setPreviewEdits((current) => ({ ...current, [reviewDraft.entryId]: { text, type, topics } }));
    setReviewDraft(null);
    setNotice('Preview updated. This review has not been saved.');
  };

  const hideSelectedPreview = async (entry: Entry) => {
    if (connection === 'live') {
      setSaving(true);
      try {
        await saveJournalFeedback(entry.id, { action: 'delete' });
        await reloadSavedJournal();
        setRemoveConfirmId(null);
        setReviewDraft(null);
        setAssertionDraft(null);
        setNotice('Journal note removed from the saved graph. The source capture remains.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not remove journal note.'); }
      finally { setSaving(false); }
      return;
    }
    setHiddenIds((current) => [...current, entry.id]);
    setLastRemovedId(entry.id);
    setRemoveConfirmId(null);
    setReviewDraft(null);
    setAssertionDraft(null);
    setNotice('Note removed from this preview. Source data has not changed.');
  };

  const undoRemoval = () => {
    if (!lastRemovedId) return;
    setHiddenIds((current) => current.filter((id) => id !== lastRemovedId));
    setSelectedId(lastRemovedId);
    setLastRemovedId(null);
    setNotice('Note restored to this preview.');
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
                  <div role="listitem" key={entry.id} data-entry-id={entry.id}>
                    <KnowledgeNoteCard note={entry} selected={selectedEntry?.id === entry.id} onSelect={() => chooseEntry(entry)} />
                  </div>
                ))}
              </section>)}
              {filteredEntries.length === 0 && <div className="pi-empty-state"><strong>No notes match</strong><span>Try another search or remove a filter.</span><button className="pi-button" type="button" onClick={clearAll}>Clear search and filters</button></div>}
            </div>
          </section>
        ) : (
          <KnowledgeGraph entries={filteredEntries} selectedId={selectedEntry?.id} theme={theme} scopeSummary={scopeSummary}
            onSelectEntry={(entry) => { setSelectedId(entry.id); setNotice(`Selected journal note: ${entry.text}`); }}
            onSelectTopic={(topic) => { selectTopic(topic); setNotice(`Showing notes tagged ${topic}`); }}
            onSelectSource={(entry) => {
              setSelectedId(entry.id);
              setSelectedTopics([]);
              setSelectedType('all');
              setDateRange('any');
              setQuery(entry.sourceLabel);
              setMode('journal');
              setNotice(`Showing journal notes from ${entry.sourceLabel}`);
            }}
            onReset={clearAll} />
        )}

        <aside className="entry-detail pi-surface" aria-label="Selected journal note"
          data-entry-id={selectedEntry?.id}>
          {selectedEntry ? (
            <>
              <div className="detail-head"><div className="detail-icon" aria-hidden="true">✳</div><div><p className="pi-kicker">JOURNAL NOTE</p><span>{selectedEntry.type.toUpperCase()}</span></div></div>
              <h2>{selectedEntry.text}</h2>
              <div className="detail-date"><span aria-hidden="true">◷</span> Captured {dateLabel(selectedEntry.createdAt)}</div>
              <div className="detail-section"><h3>TOPIC TAGS</h3><div className="detail-tags">{selectedEntry.topics.map((topic) => <button key={topic} type="button" className="tag-chip clickable" onClick={() => selectTopic(topic)}>{topic}</button>)}</div></div>
              <div className="detail-section source-section"><div className="section-title-row"><h3>SOURCE CAPTURE</h3><span className="source-badge">LINKED</span></div><SourceCapture source={selectedEntry.sourceLabel} sourceId={selectedEntry.sourceId} transcript={selectedEntry.transcript} /></div>
              <section className="review-section" aria-label="Review selected note">
                <div className="review-heading"><h3>REVIEW THIS NOTE</h3><span>{connection === 'live' ? 'SAVED GRAPH' : 'LOCAL PREVIEW'}</span></div>
                <p>{connection === 'live' ? 'Correct this journal note or remove it from the saved graph. The source capture remains available.' : 'Try a correction or remove this note from the map. Changes reset when you reload.'}</p>
                {reviewDraft?.entryId === selectedEntry.id ? (
                  <div className="review-form"><JournalCorrectionForm key={reviewDraft.entryId} initial={{ text: reviewDraft.text, type: reviewDraft.type, topics: reviewDraft.topics.split(',').map((topic) => topic.trim()).filter(Boolean) }} saving={saving} saveLabel={connection === 'live' ? 'Save correction' : 'Apply preview'} onSave={applyReviewPreview} onCancel={() => setReviewDraft(null)} /></div>
                ) : removeConfirmId === selectedEntry.id ? (
                  <div className="review-confirm" role="group" aria-label="Confirm removal">
                    <strong>Remove this note from {connection === 'live' ? 'the saved graph' : 'the preview'}?</strong>
                    <p>{connection === 'live' ? 'The source capture and audit record remain available.' : 'The source capture remains available. No saved graph data will change.'}</p>
                    <div className="review-actions"><button className="pi-button review-danger" type="button" disabled={saving} onClick={() => hideSelectedPreview(selectedEntry)}>{saving ? 'Removing…' : 'Remove note'}</button><button className="pi-button" type="button" disabled={saving} onClick={() => setRemoveConfirmId(null)}>Cancel</button></div>
                  </div>
                ) : (
                  <div className="review-actions"><button className="pi-button review-primary" type="button" onClick={() => startReview(selectedEntry)}>Correct note</button><button className="pi-button" type="button" onClick={() => setRemoveConfirmId(selectedEntry.id)}>Remove node</button></div>
                )}
              </section>
              <section className="review-section assertion-section" aria-label="Review source assertion">
                <div className="review-heading"><h3>ASSERTION LABEL</h3><span>{connection === 'live' ? 'REVIEW RECORD' : 'LOCAL PREVIEW'}</span></div>
                <p>This journal capture has no verified owner-turn provenance or classifier prediction. Check the source before proposing a label.</p>
                {assertionPreviews[selectedEntry.id] && <p className="review-result">{assertionPreviews[selectedEntry.id].ownerAuthored === 'no'
                  ? 'Excluded from owner assertion examples'
                  : `${connection === 'live' ? 'Reviewed label' : 'Proposed label'}: ${assertionPreviews[selectedEntry.id].kind}`}</p>}
                {assertionDraft?.entryId === selectedEntry.id ? (
                  <div className="review-form">
                    <fieldset className="assertion-authorship"><legend>Was this source turn authored by the owner?</legend>
                      {(['yes', 'no', 'unknown'] as const).map((value) => <label key={value}><input type="radio" name="owner-authored" checked={assertionDraft.ownerAuthored === value} onChange={() => setAssertionDraft({ ...assertionDraft, ownerAuthored: value, kind: '', profileField: 'none' })} />{value === 'yes' ? 'Yes' : value === 'no' ? 'No' : 'Unsure'}</label>)}
                    </fieldset>
                    {assertionDraft.ownerAuthored === 'yes' && <>
                      <label>Assertion kind<select value={assertionDraft.kind} onChange={(event) => setAssertionDraft({ ...assertionDraft, kind: event.target.value as AssertionKind, profileField: 'none' })}><option value="">Choose a kind</option><option value="none">None</option><option value="conversation_topic">Conversation topic</option><option value="skill_evidence">Skill evidence</option><option value="profile_update">Profile update</option></select></label>
                      {assertionDraft.kind === 'profile_update' && <label>Profile field<select value={assertionDraft.profileField} onChange={(event) => setAssertionDraft({ ...assertionDraft, profileField: event.target.value as ProfileField })}><option value="none">Choose a field</option><option value="job_title">Job title</option><option value="home_location">Home location</option><option value="credential">Credential</option><option value="employment">Employment</option></select></label>}
                    </>}
                    <label>Review reason<textarea value={assertionDraft.reason} onChange={(event) => setAssertionDraft({ ...assertionDraft, reason: event.target.value })} rows={2} placeholder="Why this authorship and label?" /></label>
                    <div className="review-actions"><button className="pi-button review-primary" type="button" disabled={saving || assertionDraft.ownerAuthored === 'unknown' || assertionDraft.reason.trim().length < 3 || (assertionDraft.ownerAuthored === 'yes' && (!assertionDraft.kind || (assertionDraft.kind === 'profile_update' && assertionDraft.profileField === 'none')))} onClick={applyAssertionPreview}>{saving ? 'Saving…' : connection === 'live' ? 'Save review' : 'Apply label preview'}</button><button className="pi-button" type="button" disabled={saving} onClick={() => setAssertionDraft(null)}>Cancel</button></div>
                  </div>
                ) : <button className="pi-button assertion-start" type="button" onClick={() => startAssertionReview(selectedEntry)}>{assertionPreviews[selectedEntry.id] ? 'Revise label' : 'Review source'}</button>}
              </section>
              <div className="detail-footer"><span className="read-only-mark" aria-hidden="true">◉</span><span>{connection === 'live' ? 'Owner authenticated graph review' : 'Sample mode · graph writes unavailable'}</span></div>
            </>
          ) : (
            <div className="pi-empty-state"><strong>Select a journal note</strong><span>Its source and topic connections will appear here.</span></div>
          )}
        </aside>
      </section>

      {lastRemovedId && <div className="review-undo" role="status">Note removed from this preview. <button type="button" onClick={undoRemoval}>Undo</button></div>}
      <p className="knowledge-status" aria-live="polite">{notice}</p>
      <footer className="knowledge-footer"><span>PI / PRIVATE DIGITAL TWIN</span><span>{connection === 'live' ? 'Oxigraph journal review' : 'Review UX preview · sample data'}</span></footer>
    </main>
  );
};

// Reporting taxonomy inferred from the behavior named by each test. These labels
// describe test intent; they are not a separate product-requirements source.
const behavior = (epic, feature, story) => ({ epic, feature, story });

function inferBehavior(suite, title) {
  const name = title.toLowerCase();
  if (suite === 'Playwright · knowledge-c2-mock') return behavior('Knowledge and review', 'Review decisions', 'Keep a corrected journal entry linked across C2 mock boundaries');
  if (suite === 'Playwright · knowledge-live') return behavior('Knowledge and review', 'Review decisions', 'Correct a test-owned entry in the deployed graph');
  if (suite === 'Playwright · diagnostics-c2-mock') return behavior('Voice conversation', 'Input diagnostics', 'Inspect conversation diagnostics');
  if (suite === 'Playwright · durable-c2-mock') return behavior('Durable work', 'Task execution', 'Approve scratch work and inspect C2 failures');
  if (suite === 'Playwright · flutter-responsive-c2-mock') return behavior('Voice conversation', 'Voice interface', 'Navigate Flutter home and workspace across screen sizes');
  if (suite === 'Pi Durable owner C2 mock') return behavior('Durable work', 'Task execution', 'Create, query, abort, and retry tasks through the owner client');
  if (suite === 'Playwright · pi-durable-mcp-integration') {
    if (/follow-up/u.test(name)) return behavior('Durable work', 'Task execution', 'Continue a task conversation from voice');
    if (/gondolin|host/u.test(name)) return behavior('Durable work', 'Task execution', 'Run task tools in the selected environment');
    return behavior('Durable work', 'Task execution', 'Call an allowlisted MCP product tool');
  }
  if (suite === 'Playwright · knowledge-base') {
    if (/saves a note correction/u.test(name)) return behavior('Knowledge and review', 'Review decisions', 'Save a correction and review assertions');
    if (/browses|filters|cytoscape/u.test(name)) return behavior('Knowledge and review', 'Journal exploration', 'Explore and filter journal knowledge');
  }
  if (suite === 'Playwright · voice') {
    if (/phone viewport/u.test(name)) return behavior('Voice conversation', 'Voice interface', 'Use voice controls on a phone');
    if (/journal knowledge/u.test(name)) return behavior('Voice conversation', 'Knowledge navigation', 'Open journal knowledge from Pi');
    if (/grafana trace/u.test(name)) return behavior('Embedded apps', 'Trace inspection', 'Open a Grafana trace in voice chat');
    if (/deployed voice session/u.test(name)) return behavior('Voice conversation', 'Voice session', 'Complete a session and retain diagnostics');
  }
  if (suite === 'Playwright · voice-telemetry') return behavior('Voice conversation', 'Voice session',
    'Complete a tailnet voice turn with correlated Tempo and OTel evidence');
  if (suite === 'Playwright · diagnostics') return behavior('Voice conversation', 'Input diagnostics', 'Inspect a conversation replay and audio levels');
  if (suite === 'Playwright · task-diagram') return behavior('Durable work', 'Task diagrams', 'Open a persisted task diagram');
  if (suite === 'Playwright · durable') return behavior('Durable work', 'Task execution', 'Approve work and retrieve its artifact');
  if (suite === 'Playwright · grafana') return behavior('Operations', 'Architecture dashboard', 'Inspect the live C4 health map');
  if (suite === 'Playwright · tailnet-owner-integration') return behavior('Gateway access', 'Capabilities', 'Reject a different tailnet user at protected routes');
  if (suite === 'Patrol web') {
    if (/workspace/u.test(name)) return behavior('Durable work', 'Workspace', 'Continue durable work in the browser');
    if (/live edge/u.test(name)) return behavior('Voice conversation', 'Live edge', 'Complete a typed turn through the edge');
    if (/voice shell/u.test(name)) return behavior('Voice conversation', 'Voice interface', 'Navigate the voice shell');
  }
  if (suite === 'MCP App browser') {
    if (/theme|light mode|design tokens/u.test(name)) return behavior('Embedded apps', 'Appearance', 'Keep embedded apps readable across themes');
    if (/journal (review|queue)|recogito|correction form/u.test(name)) return behavior('Knowledge and review', 'Journal review app', 'Review a journal entry');
    if (/playwright recording|trace viewer/u.test(name)) return behavior('Embedded apps', 'Trace inspection', 'Inspect a Playwright recording');
    if (/allowlist/u.test(name)) return behavior('Embedded apps', 'Sandbox access', 'Block unapproved app resources');
    if (/concurrent mounts|host element/u.test(name)) return behavior('Embedded apps', 'App lifecycle', 'Mount the latest app reliably');
    if (/renders (excalidraw|journal review|marp|mermaid)/u.test(name)) return behavior('Embedded apps', 'App rendering', 'Render an app inside the sandbox');
  }
  if (suite === 'Journal MCP contract' || suite === 'Deployed MCP save round trip') {
    if (/correction|gateway adapter/u.test(name)) return behavior('Knowledge and review', 'Review decisions', 'Save an evidence-backed correction');
    if (/journal suggestion/u.test(name)) return behavior('Knowledge and review', 'Journal review app', 'Review a journal suggestion');
  }
  if (suite === 'Gateway') {
    if (/song_/u.test(name)) return behavior('Media creation', 'Song workflow', 'Review and render a song');
    if (/digital_twin_query/u.test(name)) return behavior('Digital twin', 'Personal context', 'Read scoped personal context');
    if (/completed_turn/u.test(name)) return behavior('Digital twin', 'Turn ingestion', 'Queue a completed turn once');
    if (/task_approval/u.test(name)) return behavior('Durable work', 'Task approval', 'Approve a task with trace context');
    if (/task_artifact/u.test(name)) return behavior('Durable work', 'Task artifacts', 'Download an owned artifact');
    if (/task_progress|tasks_can_be/u.test(name)) return behavior('Durable work', 'Task progress', 'Inspect task state by session');
    if (/journal_edit/u.test(name)) return behavior('Knowledge and review', 'Journal editing', 'Edit journal topics safely');
    if (/journal_feedback/u.test(name)) return behavior('Knowledge and review', 'Review decisions', 'Record and export journal feedback');
    if (/assertion_review/u.test(name)) return behavior('Knowledge and review', 'Assertion review', 'Review assertions from their owner');
    if (/classifier_candidates|pending_candidate|pending_candidates/u.test(name)) return behavior('Knowledge and review', 'Candidate promotion', 'Keep candidates pending until owner review');
    if (/journal_writer/u.test(name)) return behavior('Knowledge and review', 'Journal writing', 'Write to the bounded journal graph');
    if (/health_|gateway_capability|voice_view/u.test(name)) return behavior('Gateway access', 'Capabilities', 'Protect privileged gateway data');
  }
  if (suite === 'Knowledge core') {
    if (/assertion_review/u.test(name)) return behavior('Knowledge and review', 'Assertion review', 'Validate assertion authorship and profile field');
    if (/journal_edits|topic_rows/u.test(name)) return behavior('Knowledge and review', 'Journal serialization', 'Encode bounded journal entries');
    if (/invalid_and_oversized/u.test(name)) return behavior('Knowledge and review', 'Response validation', 'Reject invalid or oversized responses');
  }
  if (suite === 'Grafana MCP observability') return behavior('Embedded apps', 'Trace inspection', 'Inspect a fresh Tempo trace through Grafana MCP');
  if (suite === 'Voice Edge broker mock') return behavior('Voice conversation', 'Voice session', 'Normalize Pi completion and failure responses at the broker boundary');
  if (suite === 'Broker Pi stream mock') return behavior('Voice conversation', 'Voice session', 'Translate Pi streaming events through the broker');
  if (suite === 'Deployed personal knowledge') return behavior('Digital twin', 'Personal context', 'Retrieve sourced personal knowledge through Wassette');
  if (suite === 'C4 dashboard contract') return behavior('Operations', 'Architecture dashboard', 'Inspect the source-backed C4 health map');
  return { ...behavior('Voice Agent', suite, title), needsReview: true };
}

const journeys = {
  'Voice conversation': {
    'Voice interface': 'Talk with Pi',
    'Voice session': 'Talk with Pi',
    'Knowledge navigation': 'Explore journal knowledge from Pi',
    'Live edge': 'Talk with Pi',
    'Input diagnostics': 'Inspect conversation diagnostics',
  },
  'Knowledge and review': {
    'Journal exploration': 'Explore journal knowledge',
    'Review decisions': 'Correct and review journal knowledge',
    'Journal review app': 'Correct and review journal knowledge',
    'Journal editing': 'Correct and review journal knowledge',
    'Journal serialization': 'Correct and review journal knowledge',
    'Journal writing': 'Correct and review journal knowledge',
    'Assertion review': 'Review personal assertions',
    'Candidate promotion': 'Review personal assertions',
    'Response validation': 'Review personal assertions',
  },
  'Embedded apps': {
    'Trace inspection': 'Inspect a trace in Pi',
    'Appearance': 'Use MCP apps in Pi',
    'Sandbox access': 'Use MCP apps in Pi',
    'App lifecycle': 'Use MCP apps in Pi',
    'App rendering': 'Use MCP apps in Pi',
  },
  'Durable work': {
    Workspace: 'Continue durable work',
    'Task execution': 'Continue durable work',
    'Task approval': 'Continue durable work',
    'Task artifacts': 'Continue durable work',
    'Task progress': 'Continue durable work',
    'Task diagrams': 'Continue durable work',
  },
  'Gateway access': { Capabilities: 'Access the protected gateway' },
  'Digital twin': {
    'Personal context': 'Use personal context',
    'Turn ingestion': 'Record a completed conversation',
  },
  'Media creation': { 'Song workflow': 'Create and review a song' },
  Operations: { 'Architecture dashboard': 'Inspect system health' },
};

const layers = {
  journey: '01 · User journey (black box)',
  deployedIntegration: '02 · Deployed integration (grey box)',
  integration: '03 · App and fixture integration (grey box)',
  observability: '04 · Observability',
  contract: '05 · Component contract',
  unit: '06 · Unit',
};

function layerFor(suite, title) {
  if (suite === 'Playwright · knowledge-c2-mock') return 'integration';
  if (suite === 'Playwright · tailnet-owner-integration') return 'deployedIntegration';
  if (suite === 'Playwright · knowledge-live') return 'deployedIntegration';
  if (suite === 'Playwright · diagnostics-c2-mock') return 'integration';
  if (suite === 'Playwright · durable-c2-mock') return 'integration';
  if (suite === 'Playwright · flutter-responsive-c2-mock') return 'integration';
  if (suite === 'Pi Durable owner C2 mock') return 'integration';
  if (suite === 'Playwright · pi-durable-mcp-integration') return 'integration';
  if (suite === 'Playwright · knowledge-base') return 'integration';
  if (suite === 'Playwright · task-diagram') return 'integration';
  if (suite === 'Patrol web' && /workspace/u.test(title.toLowerCase())) return 'integration';
  if (suite.startsWith('Playwright · ') || suite === 'Patrol web') return 'journey';
  if (suite === 'Deployed MCP save round trip') return 'deployedIntegration';
  if (suite === 'Deployed personal knowledge') return 'deployedIntegration';
  if (suite === 'Voice Edge broker mock') return 'integration';
  if (suite === 'Broker Pi stream mock') return 'integration';
  if (suite === 'Grafana MCP observability') return 'observability';
  if (suite === 'C4 dashboard contract') return 'contract';
  if (suite === 'MCP App browser' && /playwright recording|trace viewer/u.test(title.toLowerCase())) return 'observability';
  if (suite === 'Gateway' && /health_/u.test(title.toLowerCase())) return 'observability';
  if (suite === 'MCP App browser' || suite === 'Journal MCP contract') return 'integration';
  if (suite === 'Gateway') return 'contract';
  if (suite === 'Knowledge core') return 'unit';
  return 'contract';
}

export function inferIntent(suite, title) {
  const intent = inferBehavior(suite, title);
  const layer = layerFor(suite, title);
  const journey = journeys[intent.epic]?.[intent.feature];
  return {
    epic: intent.epic,
    feature: journey ?? intent.story,
    story: layers[layer],
    capability: intent.feature,
    behavior: intent.story,
    validationLayer: layer,
    ...(intent.needsReview || !journey ? { needsReview: true } : {}),
  };
}

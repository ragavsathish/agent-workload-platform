// Architecture references identify the C4 boundary a test targets. They do not
// turn a fixture-backed test into proof that every named runtime was exercised.
const views = {
  context: 'c1-system-context.mmd',
  containers: 'c2-container.mmd',
  browser: 'c3-browser-client.mmd',
  diagnostics: 'c3-input-diagnostics.mmd',
  knowledge: 'c3-journal-knowledge.mmd',
  edge: 'c3-voice-edge.mmd',
  broker: 'c3-inference-broker.mmd',
  piVoice: 'c3-pi-voice-service.mmd',
  gateway: 'c3-agent-gateway.mmd',
  voiceTurn: 'd1-interactive-voice-turn.mmd',
  delegatedTask: 'd2-delegated-task.mmd',
  deployment: 'deployment-security.mmd',
};

const scope = (level, containers, viewNames, code) => ({
  level,
  containers,
  views: viewNames.map((name) => views[name]),
  ...(code ? { code } : {}),
});

export function inferC4Scope(suite, title) {
  const name = title.toLowerCase();
  if (suite === 'Playwright · knowledge-c2-mock') return scope('C2 fixture-backed integration',
    ['Journal & Knowledge', 'Voice Edge', 'Knowledge Graph Store'], ['containers', 'knowledge']);
  if (suite === 'Playwright · knowledge-live') return scope('C2 deployed integration',
    ['Journal & Knowledge', 'Voice Edge', 'Agent Gateway', 'Knowledge Graph Store'],
    ['containers', 'knowledge', 'gateway']);
  if (suite === 'Playwright · diagnostics-c2-mock') return scope('C2 fixture-backed integration',
    ['Input Diagnostics', 'Voice Edge'], ['containers', 'diagnostics']);
  if (suite === 'Playwright · durable-c2-mock') return scope('C2 fixture-backed integration',
    ['Browser Voice Client', 'Voice Edge', 'Agent Gateway', 'Task Database and Queue',
      'Pi Task Worker', 'Workspace and Result Store'], ['containers', 'browser', 'delegatedTask']);
  if (suite === 'Pi Durable owner C2 mock') return scope('C2 fixture-backed integration',
    ['Pi Task Worker', 'Pi Task Session'], ['containers', 'delegatedTask']);
  if (suite === 'Playwright · knowledge-base') {
    return scope('C3 browser integration with route fixtures',
      ['Journal & Knowledge'], ['knowledge']);
  }
  if (suite === 'Playwright · diagnostics') return scope('C2 deployed browser journey',
    ['Input Diagnostics', 'Voice Edge'], ['containers', 'diagnostics']);
  if (suite === 'Playwright · task-diagram') return scope('C3 fixture-backed browser integration',
    ['Browser Voice Client'], ['browser']);
  if (suite === 'Playwright · durable') return scope('C1/C2 system journey',
    ['Tailnet Ingress', 'Path Router', 'Browser Voice Client', 'Voice Edge', 'Agent Gateway',
      'Task Database and Queue', 'Pi Task Worker', 'Pi Task Session', 'Task Tool Sandbox',
      'Workspace and Result Store'], ['context', 'containers', 'delegatedTask']);
  if (suite === 'Playwright · grafana') return scope('C2 authenticated dashboard journey',
    ['Tailnet Ingress', 'Path Router', 'Metrics and Traces'], ['containers', 'deployment']);
  if (suite === 'Playwright · voice') {
    if (/deployed voice session/u.test(name)) return scope('C1/C2 system journey',
      ['Browser Voice Client', 'Voice Edge', 'Inference Broker', 'Pi Voice Service', 'Metrics and Traces'],
      ['context', 'containers', 'browser', 'edge', 'broker', 'piVoice', 'voiceTurn']);
    if (/journal knowledge/u.test(name)) return scope('C2 cross-container journey',
      ['Browser Voice Client', 'Journal & Knowledge'], ['containers', 'browser', 'knowledge']);
    if (/grafana trace/u.test(name)) return scope('C2 cross-container journey',
      ['Browser Voice Client', 'Voice Edge', 'Grafana MCP', 'Metrics and Traces'], ['containers', 'browser']);
    return scope('C3 browser journey', ['Browser Voice Client'], ['browser']);
  }
  if (suite === 'Patrol web') {
    if (/live edge/u.test(name)) return scope('C2 protocol journey',
      ['Browser Voice Client', 'Voice Edge'], ['containers', 'edge']);
    return scope('C3 browser journey', ['Browser Voice Client'], ['browser']);
  }
  if (suite === 'MCP App browser') return scope('C3 browser integration', ['Browser Voice Client'], ['browser']);
  if (suite === 'Deployed MCP save round trip') return scope('C2 deployed integration',
    ['Journal Review MCP', 'Agent Gateway', 'Knowledge Graph Store'], ['containers', 'gateway']);
  if (suite === 'Deployed personal knowledge') return scope('C2 deployed integration',
    ['Wassette Integration Runtime', 'Agent Gateway', 'Knowledge Graph Store'], ['containers', 'gateway']);
  if (suite === 'Grafana MCP observability') return scope('C2 deployed observability',
    ['Grafana MCP', 'Metrics and Traces'], ['containers']);
  if (suite === 'Voice Edge broker mock') return scope('C2 fixture-backed integration',
    ['Voice Edge', 'Inference Broker'], ['containers', 'edge']);
  if (suite === 'Broker Pi stream mock') return scope('C2 fixture-backed integration',
    ['Inference Broker', 'Pi Voice Service'], ['containers', 'broker', 'voiceTurn']);
  if (suite === 'C4 dashboard contract') return scope('Code-level architecture contract',
    [], ['containers'], 'C4 Dashboard Generator');
  if (suite === 'Journal MCP contract') return scope('C2 container contract', ['Journal Review MCP'], ['containers']);
  if (suite === 'Gateway') return scope('C3 gateway contract', ['Agent Gateway'], ['gateway']);
  if (suite === 'Knowledge core') return scope('Code-level unit', [], [], 'Personal Knowledge Core');
  if (suite === 'Command gates') return scope('Execution gate', [], []);
  return { level: 'Unmapped', containers: [], views: [], needsReview: true };
}

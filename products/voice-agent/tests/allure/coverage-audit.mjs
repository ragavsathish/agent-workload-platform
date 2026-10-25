const labelValues = (item, name) => (item.labels ?? []).filter((label) => label.name === name)
  .map((label) => label.value);
const label = (item, name) => labelValues(item, name)[0] ?? '';

export function evidenceMode(item) {
  const suite = label(item, 'suite');
  const level = label(item, 'c4Level');
  const layer = label(item, 'validationLayer');
  if (suite === 'Command gates') return 'gate';
  if (suite === 'Patrol web' || /fixture|mock/iu.test(`${suite} ${level}`)) return 'fixture';
  if (layer === 'deployedIntegration' || layer === 'observability'
      || /deployed|system journey|cross-container journey|authenticated dashboard/iu.test(level)) {
    return 'deployed';
  }
  if (layer === 'contract' || layer === 'unit') return 'contract';
  return 'fixture';
}

export function c2Elements(mermaid) {
  const names = new Map([...mermaid.matchAll(/^\s*([A-Z][A-Z_0-9]+)\[.*?<b>([^<]+)<\/b>/gmu)]
    .map(([, id, name]) => [id, name]));
  const ids = [...mermaid.matchAll(/^\s*class ([A-Z_,]+) (?:container|data);/gmu)]
    .flatMap(([, members]) => members.split(','));
  return ids.map((id) => names.get(id)).filter(Boolean);
}

const blankCounts = () => ({ passed: 0, skipped: 0, failed: 0,
  deployedPassed: 0, fixturePassed: 0, contractPassed: 0 });

export function coverageAudit(items, mermaid, diagramNames = []) {
  const journeys = new Map();
  const containers = new Map(c2Elements(mermaid).map((name) => [name, blankCounts()]));
  const views = new Map(diagramNames.map((name) => [name, blankCounts()]));
  for (const item of items) {
    const epic = label(item, 'epic');
    const feature = label(item, 'feature');
    const layer = label(item, 'validationLayer');
    if (epic && feature && layer && label(item, 'suite') !== 'Command gates') {
      const key = `${epic} / ${feature}`;
      const row = journeys.get(key) ?? { intendedUse: epic, journey: feature, layers: {}, systemPathPassed: 0, failed: 0 };
      const layerCounts = row.layers[layer] ?? { passed: 0, skipped: 0, failed: 0 };
      layerCounts[item.status] = (layerCounts[item.status] ?? 0) + 1;
      row.layers[layer] = layerCounts;
      if (item.status === 'passed' && label(item, 'c4Level') === 'C1/C2 system journey') row.systemPathPassed++;
      if (item.status === 'failed') row.failed++;
      journeys.set(key, row);
    }
    const mode = evidenceMode(item);
    for (const name of labelValues(item, 'c4Container')) {
      const row = containers.get(name);
      if (row) {
        row[item.status] = (row[item.status] ?? 0) + 1;
        if (item.status === 'passed' && mode !== 'gate') row[`${mode}Passed`]++;
      }
    }
    for (const name of labelValues(item, 'c4View')) {
      const row = views.get(name);
      if (row) {
        row[item.status] = (row[item.status] ?? 0) + 1;
        if (item.status === 'passed' && mode !== 'gate') row[`${mode}Passed`]++;
      }
    }
  }
  return {
    cases: items.length,
    journeys: [...journeys.values()].sort((left, right) =>
      `${left.intendedUse}/${left.journey}`.localeCompare(`${right.intendedUse}/${right.journey}`)),
    c2Elements: [...containers].map(([name, counts]) => ({ name, ...counts })),
    views: [...views].map(([name, counts]) => ({ name, ...counts })),
  };
}

const count = (layers, key) => layers[key]?.passed ?? 0;
const cell = (value) => value ? String(value) : '—';

export function coverageAuditMarkdown(audit, { runId, commit, counts }) {
  const journeyRows = audit.journeys.map(({ intendedUse, journey, layers, systemPathPassed, failed }) =>
    `| ${intendedUse} | ${journey} | ${cell(count(layers, 'journey'))} | ${cell(systemPathPassed)} | ${cell(count(layers, 'deployedIntegration'))} | ${cell(count(layers, 'integration'))} | ${cell(count(layers, 'observability'))} | ${cell(count(layers, 'contract'))} | ${cell(count(layers, 'unit'))} | ${cell(failed)} |`);
  const missing = audit.c2Elements.filter(({ deployedPassed }) => deployedPassed === 0).map(({ name }) => name);
  const c2Rows = audit.c2Elements.map(({ name, deployedPassed, fixturePassed, contractPassed }) =>
    `| ${name} | ${cell(deployedPassed)} | ${cell(fixturePassed)} | ${cell(contractPassed)} |`);
  const viewRows = (audit.views ?? []).map(({ name, deployedPassed, fixturePassed, contractPassed }) =>
    `| ${name} | ${cell(deployedPassed)} | ${cell(fixturePassed)} | ${cell(contractPassed)} |`);
  const durableSystemPath = audit.journeys.some(({ intendedUse, journey, systemPathPassed }) =>
    intendedUse === 'Durable work' && journey === 'Continue durable work' && systemPathPassed > 0);
  const remainingPaths = [
    ...(!durableSystemPath ? ['- Approve a real durable task, observe isolated Pi execution, and retrieve its artifact through the browser. The current Patrol workspace check uses a protocol fixture.'] : []),
    '- Open a journal review MCP App from a live Pi turn, correct the note in that App, and verify the owner-visible result. The App browser and deployed MCP save checks currently run separately.',
    '- Verify exact-owner tailnet ingress with negative identity cases. The authenticated Grafana browser journey proves rendering, but does not prove rejection of a different user.',
    '- Correlate a fresh user voice turn with its own OTel trace and metric delta. The Grafana MCP probe proves a fresh trace for its own call; the voice journey checks replay and metrics without proving that telemetry link.',
  ];
  return `# Voice Agent test coverage audit\n\nRun: ${runId} · Git: ${commit} · ${counts.passed ?? 0} passed, ${counts.skipped ?? 0} skipped, ${counts.failed ?? 0} failed.\n\n` +
    'This matrix counts cases in this Allure run. A passed supporting check does not establish an end-to-end journey. Fixture-backed browser tests are integration evidence, and a skipped case does not count as passed.\n\n' +
    '| Intended use | User journey | Black box | C1/C2 system path | Deployed integration | App/fixture integration | Observability | Contract | Unit | Failed |\n' +
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n' +
    `${journeyRows.join('\n')}\n\n` +
    '## C4 view mapping\n\nCounts are passed cases mapped to each source view. They do not mean every arrow or component in that view was exercised.\n\n' +
    '| Source view | Deployed | Fixture | Contract/unit |\n| --- | ---: | ---: | ---: |\n' +
    `${viewRows.join('\n')}\n\n` +
    '## C2 element mapping\n\nFixtures represent the named production boundary; they do not run that downstream container.\n\n' +
    '| C2 element | Deployed | Fixture | Contract/unit |\n| --- | ---: | ---: | ---: |\n' +
    `${c2Rows.join('\n')}\n\n` +
    `### C2 elements without deployed evidence in this run\n\n${missing.length ? missing.map((name) => `- ${name}`).join('\n') : 'None'}\n\n` +
    'These are report gaps, not proof that the element has no tests elsewhere. A mapped case identifies its target view or container; only its evidence mode says whether the production runtime ran.\n\n' +
    `## Highest-value remaining paths\n\n${remainingPaths.join('\n')}\n`;
}

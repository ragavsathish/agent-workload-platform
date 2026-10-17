import { test, expect, expectCleanBrowser } from './fixtures';

const evidenceStrokes = new Set([
  'rgb(86, 227, 159)',
  'rgb(255, 189, 118)',
  'rgb(114, 183, 239)',
  'rgb(255, 119, 138)',
]);

const relativeLuminance = (color) => {
  const channels = color.match(/[\d.]+/g).slice(0, 3)
    .map((value) => Number(value) / 255)
    .map((value) => (value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (first, second) => {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test('renders every operational C4 panel with accessible color semantics', async ({
  page,
  browserEvidence,
}, testInfo) => {
  await page.goto('/metrics/d/voice-c4-heatmap/c4-operational-heat-map', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByText('C4 Operational Heat Map', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });

  const dashboard = await page.evaluate(async () => {
    const response = await fetch('/metrics/api/dashboards/uid/voice-c4-heatmap');
    if (!response.ok) throw new Error(`Grafana dashboard API returned ${response.status}`);
    return response.json();
  });
  const diagramPanels = dashboard.dashboard.panels.filter(
    (panel) => panel.type === 'neildengg-grafmaid-panel',
  );
  expect(diagramPanels).toHaveLength(15);
  expect(dashboard.dashboard.refresh).toBe('30s');
  expect(dashboard.dashboard.links).toHaveLength(2);
  expect(dashboard.dashboard.annotations.list[0].name).toBe('Deployments and E2E runs');
  expect(diagramPanels.filter((panel) => panel.targets.length > 0).map((panel) => panel.title))
    .toEqual(['C2 · Containers']);

  for (const panel of diagramPanels) {
    const title = page.getByText(panel.title, { exact: true }).first();
    await title.scrollIntoViewIfNeeded();
    await expect(title).toBeVisible();
    await expect.poll(async () => title.evaluate((element) => {
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 10; depth += 1) {
        if (ancestor.querySelector('svg')) return true;
        ancestor = ancestor.parentElement;
      }
      return false;
    }), { message: `${panel.title} did not render an SVG` }).toBe(true);
  }

  const voiceEdgePanel = diagramPanels.find((panel) => panel.title === 'C2 · Containers');
  expect(voiceEdgePanel).toBeDefined();
  const voiceEdgeExpression = voiceEdgePanel.targets[0].expr.replaceAll('$__range', '15m');
  const voiceEdgeActivity = await page.evaluate(async (expression) => {
    const query = new URLSearchParams({ query: expression });
    const response = await fetch(
      `/metrics/api/datasources/proxy/uid/prometheus/api/v1/query?${query}`,
    );
    if (!response.ok) throw new Error(`Prometheus query returned ${response.status}`);
    const payload = await response.json();
    return Number(payload.data.result[0].value[1]);
  }, voiceEdgeExpression);
  const expectedStep = voiceEdgePanel.fieldConfig.defaults.thresholds.steps
    .filter((step) => step.value === null || voiceEdgeActivity >= step.value)
    .at(-1);
  const expectedFill = `rgb(${expectedStep.color.match(/[\da-f]{2}/gi)
    .map((part) => Number.parseInt(part, 16)).join(', ')})`;
  const voiceEdgeTitle = page.getByText('C2 · Containers', { exact: true }).first();
  await voiceEdgeTitle.scrollIntoViewIfNeeded();
  const voiceEdgePanelRoot = page.getByRole('region', { name: 'C2 · Containers', exact: true });
  const voiceEdgeShape = voiceEdgePanelRoot
    .locator('svg g[id^="flowchart-EDGE-"] > rect').first();
  const voiceEdgeLabel = voiceEdgePanelRoot.locator(
    'svg g[id^="flowchart-EDGE-"] > g.label foreignObject span.nodeLabel',
  ).first();
  await expect(voiceEdgeShape).toBeVisible();
  await expect(voiceEdgeLabel).toBeVisible();
  const voiceEdgeStyle = await voiceEdgeShape.evaluate((shape) => {
    const style = getComputedStyle(shape);
    return { fill: style.fill, stroke: style.stroke };
  });
  const voiceEdgeText = await voiceEdgeLabel.evaluate((label) => getComputedStyle(label).color);
  expect(voiceEdgeStyle.fill).toBe(expectedFill);
  expect(voiceEdgeStyle.stroke).toBe('rgb(86, 227, 159)');
  expect(contrastRatio(voiceEdgeStyle.fill, voiceEdgeText)).toBeGreaterThanOrEqual(4.5);

  const detailBackgrounds = [];
  for (const panel of diagramPanels.filter((item) => item.title !== 'C2 · Containers')) {
    const panelRoot = page.getByRole('region', { name: panel.title, exact: true });
    const fills = await panelRoot.locator('svg g.node').evaluateAll((groups) => (
      groups.flatMap((group) => {
        const shape = [...group.children]
          .find((child) => child.matches('rect, path, polygon, circle, ellipse'));
        return shape ? [getComputedStyle(shape).fill] : [];
      })
    ));
    detailBackgrounds.push(...fills.map((fill) => ({ panel: panel.title, fill })));
  }
  const nonGrayDetailBackgrounds = detailBackgrounds.filter(({ fill }) => ![
    'rgb(63, 63, 70)',
    'rgb(212, 212, 216)',
  ].includes(fill));
  expect(
    nonGrayDetailBackgrounds,
    'Only C2 may use colored node backgrounds; detail views must use neutral gray fills',
  ).toEqual([]);

  const renderedNodes = await page.locator('svg g.node, svg g.cluster').evaluateAll((groups) => (
    groups.flatMap((group) => {
      const shape = [...group.children]
        .find((child) => child.matches('rect, path, polygon, circle, ellipse'));
      const labelGroup = [...group.children]
        .find((child) => child.matches('g.label, g.cluster-label'));
      const label = labelGroup?.querySelector('foreignObject span.nodeLabel, text');
      if (!shape || !label) return [];
      return [{
        label: label.textContent?.replace(/\s+/g, ' ').trim() || group.id,
        fill: getComputedStyle(shape).fill,
        text: getComputedStyle(label).color,
      }];
    })
  ));
  const lowContrastNodes = renderedNodes
    .map((node) => ({ ...node, contrast: contrastRatio(node.fill, node.text) }))
    .filter((node) => node.contrast < 4.5);
  expect(lowContrastNodes, 'C4 nodes must remain readable in Grafana dark mode').toEqual([]);

  const connectorStyles = await page.locator('svg path.flowchart-link').evaluateAll((paths) => (
    [...new Map(paths.map((path) => {
      const style = getComputedStyle(path);
      const value = {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        opacity: style.opacity,
      };
      return [JSON.stringify(value), value];
    })).values()]
  ));
  const arrowheadStyles = await page.locator('svg marker path').evaluateAll((paths) => (
    [...new Map(paths.map((path) => {
      const style = getComputedStyle(path);
      const value = { fill: style.fill, stroke: style.stroke, opacity: style.opacity };
      return [JSON.stringify(value), value];
    })).values()]
  ));
  const edgeLabelStyles = await page.locator('svg g.edgeLabel span, svg g.edgeLabel text')
    .evaluateAll((labels) => ([...new Map(labels.map((label) => {
      const style = getComputedStyle(label);
      const value = { color: style.color, background: style.backgroundColor };
      return [JSON.stringify(value), value];
    })).values()]));

  const colors = await page.locator('svg *').evaluateAll((elements) => ({
    fills: [...new Set(elements.map((element) => getComputedStyle(element).fill))],
    strokes: [...new Set(elements.map((element) => getComputedStyle(element).stroke))],
  }));
  for (const stroke of evidenceStrokes) expect(colors.strokes).toContain(stroke);
  expect(colors.fills.some((fill) => [
    'rgb(148, 163, 184)',
    'rgb(56, 189, 248)',
    'rgb(34, 211, 238)',
    'rgb(45, 212, 191)',
  ].includes(fill))).toBe(true);

  await testInfo.attach('grafana-color-evidence', {
    body: Buffer.from(`${JSON.stringify({
      colors,
      voiceEdgeActivity,
      voiceEdgeStyle,
      voiceEdgeText,
      voiceEdgeContrast: contrastRatio(voiceEdgeStyle.fill, voiceEdgeText),
      renderedNodeCount: renderedNodes.length,
      lowContrastNodes,
      detailBackgrounds,
      nonGrayDetailBackgrounds,
      connectorStyles,
      arrowheadStyles,
      edgeLabelStyles,
    }, null, 2)}\n`),
    contentType: 'application/json',
  });
  await testInfo.attach('grafana-dashboard', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await expect(page.locator('body')).not.toContainText(
    /panel plugin not found|failed to load plugin|unexpected error/i,
  );
  expectCleanBrowser(browserEvidence);
});

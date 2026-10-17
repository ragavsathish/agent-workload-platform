import fs from 'node:fs';
const [runnerPath] = process.argv.slice(2);
if (!runnerPath) throw new Error('Patrol web runner path is required.');

const startMarker = 'await context.tracing.start({ screenshots: true, snapshots: true, sources: true })';
const stopMarker = 'await context.tracing.stop({ path: testInfo.outputPath("trace.zip") })';
let source = fs.readFileSync(runnerPath, 'utf8');
const hasStart = source.includes(startMarker);
const hasStop = source.includes(stopMarker);
if (hasStart !== hasStop) {
  throw new Error('Patrol web runner has a partial trace patch; refusing to continue.');
}
if (hasStart && hasStop) process.exit(0);

const fixtureStart = '  page: async ({ page, context }, use, testInfo) => {\n';
const fixtureEnd = `    for (const p of context.pages()) {
      if (p !== page && !p.isClosed()) {
        await p.close().catch(() => {})
      }
    }
`;

if (!source.includes(fixtureStart) || !source.includes(fixtureEnd)) {
  throw new Error('Patrol 4.10.0 web runner changed; refusing to apply the trace patch.');
}

source = source
  .replace(fixtureStart, `${fixtureStart}    ${startMarker}\n`)
  .replace(
    fixtureEnd,
    `${fixtureEnd}\n    ${stopMarker}\n`,
  );
fs.writeFileSync(runnerPath, source);

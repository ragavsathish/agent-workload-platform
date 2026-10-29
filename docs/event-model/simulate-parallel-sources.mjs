#!/usr/bin/env node
/** Deterministic model experiment for the proposed AWP event-sourced read model. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const changeId = 'awp-change-001';
const commit = 'commit-awp-002';
const artifact = 'sha256:task-result-002';
const oracle = 'sha256:measurement-oracle-001';
const lyrics = 'sha256:approved-lyrics-001';
const song = 'sha256:reviewed-song-001';

const sourceEvents = {
  knowledge: [
    ['KnowledgeRecorded', { evidenceId: 'journal-001' }],
    ['KnowledgeReviewed', { evidenceId: 'journal-001' }],
  ],
  image: [
    ['ImageHandoffPrepared', { imageRef: 'awp-image-002' }],
    ['ExecutionImageRegistered', { imageRef: 'awp-image-002' }],
  ],
  task: [
    ['TaskAccepted', { taskId: 'task-001' }],
    ['WorkspacePrepared', { taskId: 'task-001' }],
    ['TaskStarted', { taskId: 'task-001', mode: 'gondolin' }],
    ['AWPSourceChanged', { commit }],
    ['TaskResultCaptured', { artifact, commit }],
  ],
  measurement: [
    ['OracleQualified', { oracle }],
    ['BehaviorChecksPassed', { commit, oracle }],
  ],
  qualification: [
    ['ChangeQualified', { commit, artifact, oracle }],
  ],
  pr: [
    ['PrOpened', { prId: 'pr-001', commit }],
    ['PrSoundtrackPublished', { prId: 'pr-001', commit, lyrics, song, url: 'https://example.invalid/pr-001/song.m4a' }],
  ],
  lyricTask: [
    ['TaskAccepted', { taskId: 'lyrics-001', kind: 'song-lyrics' }],
    ['LyricsManifestPrepared', { lyrics }],
    ['LyricsApproved', { lyrics }],
  ],
  renderTask: [
    ['TaskAccepted', { taskId: 'render-001', kind: 'song-render' }],
    ['SongArtifactStored', { lyrics, song }],
  ],
  release: [
    ['ReleaseApproved', { commit, prId: 'pr-001' }],
    ['DeploymentConverged', { commit }],
    ['VerificationPassed', { commit }],
  ],
  alert: [
    ['StackAlertFired', { alertId: 'alert-001' }],
    ['InvestigationTaskAccepted', { alertId: 'alert-001', taskId: 'investigate-001' }],
    ['InvestigationResultCaptured', { alertId: 'alert-001', findingId: 'finding-001' }],
  ],
};

const events = Object.entries(sourceEvents).flatMap(([streamId, entries]) =>
  entries.map(([type, payload], index) => ({
    eventId: `${streamId}:${index + 1}`, streamId, streamVersion: index + 1,
    changeId, type, payload,
  })));
const byId = new Map(events.map((event) => [event.eventId, event]));
const event = (accepted, id) => accepted.get(id)?.payload;

class ParallelLedger {
  streams = new Map();
  seen = new Map();

  ingest(value) {
    const serialized = JSON.stringify(value);
    const previous = this.seen.get(value.eventId);
    if (previous !== undefined) {
      if (previous !== serialized) throw new Error(`conflicting eventId: ${value.eventId}`);
      return false;
    }
    const versions = this.streams.get(value.streamId) ?? new Map();
    const occupied = versions.get(value.streamVersion);
    if (occupied && occupied.eventId !== value.eventId) {
      throw new Error(`conflicting stream version: ${value.streamId}:${value.streamVersion}`);
    }
    versions.set(value.streamVersion, value);
    this.streams.set(value.streamId, versions);
    this.seen.set(value.eventId, serialized);
    return true;
  }

  committed() {
    const accepted = new Map();
    for (const versions of this.streams.values()) {
      for (let version = 1; versions.has(version); version++) {
        const value = versions.get(version);
        accepted.set(value.eventId, value);
      }
    }
    return accepted;
  }

  projection() {
    const accepted = this.committed();
    const get = (id) => event(accepted, id);
    const task = get('task:1');
    const imageReady = Boolean(get('image:1') && get('image:2')
      && get('image:1').imageRef === get('image:2').imageRef);
    const taskStarted = Boolean(task && get('task:2') && get('task:3'));
    const executionReady = taskStarted && (get('task:3').mode === 'host' || imageReady);
    const changed = executionReady && get('task:4')?.commit === commit;
    const result = changed && get('task:5')?.commit === commit ? get('task:5') : undefined;
    const measurementReady = get('measurement:1')?.oracle === oracle
      && get('measurement:2')?.oracle === oracle
      && get('measurement:2')?.commit === commit;
    const qualified = Boolean(result && measurementReady
      && get('qualification:1')?.commit === commit
      && get('qualification:1')?.artifact === result.artifact
      && get('qualification:1')?.oracle === oracle);
    const pr = qualified && get('pr:1')?.commit === commit ? get('pr:1') : undefined;
    const lyricReady = get('lyricTask:1')?.kind === 'song-lyrics'
      && get('lyricTask:2')?.lyrics === lyrics
      && get('lyricTask:3')?.lyrics === lyrics;
    const songReady = lyricReady && get('renderTask:1')?.kind === 'song-render'
      && get('renderTask:2')?.lyrics === lyrics
      && get('renderTask:2')?.song === song;
    const soundtrack = Boolean(pr && songReady
      && get('pr:2')?.prId === pr.prId
      && get('pr:2')?.commit === commit
      && get('pr:2')?.lyrics === lyrics
      && get('pr:2')?.song === song
      && get('pr:2')?.url);
    const releaseReady = Boolean(soundtrack
      && get('release:1')?.commit === commit
      && get('release:1')?.prId === pr.prId);
    const deployed = releaseReady && get('release:2')?.commit === commit;
    const verified = deployed && get('release:3')?.commit === commit;
    return {
      changeId,
      knowledgeReviewed: Boolean(get('knowledge:1') && get('knowledge:2')
        && get('knowledge:1').evidenceId === get('knowledge:2').evidenceId),
      imageReady, taskAccepted: Boolean(task), executionReady, resultCaptured: Boolean(result),
      measurementReady, qualified, prOpen: Boolean(pr), lyricsApproved: Boolean(lyricReady),
      songReady: Boolean(songReady), soundtrack, releaseReady, deployed: Boolean(deployed),
      verified: Boolean(verified),
      investigationCaptured: Boolean(get('alert:1') && get('alert:2') && get('alert:3')
        && get('alert:1').alertId === get('alert:2').alertId
        && get('alert:2').alertId === get('alert:3').alertId),
    };
  }
}

function rng(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function assertSafe(projection) {
  if (projection.resultCaptured) assert.equal(projection.executionReady, true);
  if (projection.qualified) assert.equal(projection.resultCaptured && projection.measurementReady, true);
  if (projection.soundtrack) assert.equal(projection.prOpen && projection.lyricsApproved && projection.songReady, true);
  if (projection.releaseReady) assert.equal(projection.qualified && projection.soundtrack, true);
  if (projection.verified) assert.equal(projection.releaseReady && projection.deployed, true);
}

function simulate(seed, selected = events) {
  const random = rng(seed);
  const deliveries = shuffle([...selected, ...selected.filter(() => random() < 0.45)], random);
  const ledger = new ParallelLedger();
  let naiveReleaseReady = false;
  let naiveSoundtrackSeen = false;
  let previousProjection = ledger.projection();
  for (const value of deliveries) {
    ledger.ingest(value);
    const projection = ledger.projection();
    assertSafe(projection);
    for (const [key, prior] of Object.entries(previousProjection)) {
      if (typeof prior === 'boolean' && prior) assert.equal(projection[key], true, `${key} regressed at seed ${seed}`);
    }
    previousProjection = projection;
    // Deliberately order-sensitive baseline: a one-shot decision on delivery.
    if (value.eventId === 'pr:2') naiveSoundtrackSeen = true;
    if (value.eventId === 'release:1') naiveReleaseReady = naiveSoundtrackSeen;
  }
  return { projection: ledger.projection(), naiveReleaseReady, deliveries: deliveries.length,
    firstReleaseIndex: deliveries.findIndex((value) => value.eventId === 'release:1'),
    firstSoundtrackIndex: deliveries.findIndex((value) => value.eventId === 'pr:2') };
}

export { ParallelLedger, events, simulate };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const reference = new ParallelLedger();
for (const value of events) reference.ingest(value);
const expected = reference.projection();
assert.equal(expected.verified, true);
const runs = Number(process.argv[2] ?? 1000);
if (!Number.isInteger(runs) || runs < 1 || runs > 100_000) throw new Error('runs must be 1..100000');
let naiveDiverged = 0;
let firstNaiveFailureSeed;
let firstNaiveFailureOrder;
let totalDeliveries = 0;
for (let seed = 1; seed <= runs; seed++) {
  const result = simulate(seed);
  assert.deepEqual(result.projection, expected, `projection diverged at seed ${seed}`);
  if (!result.naiveReleaseReady) {
    naiveDiverged++;
    if (firstNaiveFailureSeed === undefined) {
      firstNaiveFailureSeed = seed;
      firstNaiveFailureOrder = {
        releaseApprovalDelivery: result.firstReleaseIndex + 1,
        soundtrackDelivery: result.firstSoundtrackIndex + 1,
      };
    }
  }
  totalDeliveries += result.deliveries;
}

const omitted = (id) => events.filter((value) => value.eventId !== id);
const missingLyrics = simulate(17, omitted('lyricTask:3')).projection;
const missingQualification = simulate(29, omitted('qualification:1')).projection;
const missingImage = simulate(41, omitted('image:2')).projection;
const wrongSongPin = simulate(53, events.map((value) => value.eventId === 'pr:2'
  ? { ...value, payload: { ...value.payload, lyrics: 'sha256:other-lyrics' } } : value)).projection;
const wrongQualificationPin = simulate(67, events.map((value) => value.eventId === 'qualification:1'
  ? { ...value, payload: { ...value.payload, artifact: 'sha256:other-result' } } : value)).projection;
assert.equal(missingLyrics.releaseReady, false);
assert.equal(missingQualification.prOpen, false);
assert.equal(missingImage.resultCaptured, false);
assert.equal(wrongSongPin.releaseReady, false);
assert.equal(wrongQualificationPin.prOpen, false);

const conflicting = new ParallelLedger();
conflicting.ingest(byId.get('pr:1'));
assert.throws(() => conflicting.ingest({ ...byId.get('pr:1'), payload: { commit: 'different' } }), /conflicting eventId/);
assert.throws(() => conflicting.ingest({ ...byId.get('pr:1'), eventId: 'other', payload: { commit: 'different' } }), /conflicting stream version/);

console.log(JSON.stringify({
  model: 'proposed parallel event-source read model', runs, sourceStreams: Object.keys(sourceEvents).length,
  distinctEvents: events.length, totalDeliveries, converged: runs,
  naiveOrderSensitiveFailures: naiveDiverged, firstNaiveFailureSeed, firstNaiveFailureOrder,
  incomplete: {
    missingLyricsApprovalBlocksRelease: !missingLyrics.releaseReady,
    missingQualificationBlocksPr: !missingQualification.prOpen,
    missingImageRegistrationBlocksResult: !missingImage.resultCaptured,
    wrongSongPinBlocksRelease: !wrongSongPin.releaseReady,
    wrongQualificationPinBlocksPr: !wrongQualificationPin.prOpen,
  },
  conflictingEventRejected: true,
  finalProjection: expected,
}, null, 2));
}

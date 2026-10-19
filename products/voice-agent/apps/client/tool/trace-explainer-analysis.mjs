import { relative, resolve, sep } from 'node:path';

const below = (root, candidate) => {
  const path = relative(resolve(root), resolve(candidate));
  return path !== ''
    && path !== '..'
    && !path.startsWith(`..${sep}`)
    && !path.startsWith(sep);
};

export function assertSafeOutputDirectory(outputDirectory, approvedRoots) {
  if (approvedRoots.some((root) => root && below(root, outputDirectory))) return;
  throw new Error('Trace explainer output must stay below an approved output root');
}

export function applyNarrationPlan(scenes, plan) {
  if (!Array.isArray(plan?.scenes) || plan.scenes.length !== scenes.length) {
    throw new Error('Narration plan must contain one entry for every evidence scene');
  }
  const expectedIds = scenes.map(({ id }) => id);
  const receivedIds = plan.scenes.map(({ id }) => id);
  if (!expectedIds.every((id, index) => id === receivedIds[index])) {
    throw new Error('Narration plan scene IDs must match the evidence scene IDs');
  }
  return scenes.map((scene, index) => {
    if (scene.narrationSource === 'playwright-tour-step') return scene;
    const spoken = plan.scenes[index]?.spoken?.trim();
    if (!spoken || spoken.length > 320 || /https?:\/\//iu.test(spoken)) {
      throw new Error(`Narration for ${scene.id} is outside its allowed bounds`);
    }
    return { ...scene, spoken };
  });
}

export function applyNarrationBrief(scenes, narrationBrief) {
  const brief = typeof narrationBrief === 'string' ? narrationBrief.trim() : '';
  if (!brief || brief.length > 2_000) {
    throw new Error('Narration brief must contain 1 to 2,000 characters');
  }
  if (!scenes.length) throw new Error('Narration brief requires at least one evidence scene');
  const boundedWords = (value, maximum) => {
    if (value.length <= maximum) return value;
    const prefix = value.slice(0, maximum - 1).replace(/\s+\S*$/u, '').trim();
    return `${prefix || value.slice(0, maximum - 1)}…`;
  };
  const focus = boundedWords(brief
    .replaceAll(/https?:\/\/\S+/giu, 'a referenced page')
    .replaceAll(/[\n\r\t]+/gu, ' ')
    .replaceAll(/\s+/gu, ' '), 180);
  return scenes.map((scene, index) => index === 0
    ? (() => {
        return {
          ...scene,
          spoken: boundedWords(
            `${focus} Every scene stays grounded in recorded browser evidence.`,
            320,
          ),
        };
      })()
    : scene);
}

const tourFrameKey = (value) => String(value ?? '')
  .toLocaleLowerCase('en-US')
  .replaceAll(/[^a-z0-9]+/gu, '-')
  .replaceAll(/^-|-$/gu, '');

export function applyTourFrameAttachments(scenes, events) {
  const frames = events.flatMap((event) => (
    event?.type === 'after' && Array.isArray(event.attachments)
      ? event.attachments
      : []
  )).flatMap((attachment) => {
    const match = String(attachment?.name ?? '').match(/^tour-frame:(.+)$/u);
    const sha1 = typeof attachment?.sha1 === 'string' ? attachment.sha1 : '';
    return match && /^[a-f0-9]{40}$/u.test(sha1)
      ? [[tourFrameKey(match[1]), `resources/${sha1}`]]
      : [];
  });
  if (!frames.length) return scenes;
  const byTitle = new Map(frames);
  const firstFrame = frames[0][1];
  return scenes.map((scene, index) => {
    const frame = index === 0 ? firstFrame : byTitle.get(tourFrameKey(scene.title));
    return frame
      ? { ...scene, evidence: { ...scene.evidence, frame } }
      : scene;
  });
}

const errorPhrase = (count) => count === 0
  ? 'no recorded Playwright action errors'
  : `${count} recorded Playwright action ${count === 1 ? 'error' : 'errors'}`;

const semanticMethods = new Set([
  'check',
  'click',
  'dblclick',
  'fill',
  'goto',
  'press',
  'selectOption',
  'setInputFiles',
  'type',
  'uncheck',
]);

const boundedLabel = (value) => String(value ?? '')
  .replaceAll(/\\[bBdDsSwW]/gu, '')
  .replaceAll(/[\n\r\t]+/gu, ' ')
  .replaceAll(/\s+/gu, ' ')
  .trim()
  .slice(0, 80);

const selectorLabel = (selector) => {
  const source = String(selector ?? '');
  const patterns = [
    /name=\/([^/]+)\/[a-z]*/iu,
    /name=["']([^"']+)["']/iu,
    /(?:label|text)=\/([^/]+)\/[a-z]*/iu,
    /(?:label|text)=["']([^"']+)["']/iu,
  ];
  return boundedLabel(patterns.map((pattern) => source.match(pattern)?.[1]).find(Boolean));
};

const pageLabel = (value) => {
  try {
    const segments = new URL(String(value)).pathname.split('/').filter(Boolean);
    return boundedLabel(decodeURIComponent(segments.at(-1) ?? 'application'));
  } catch {
    return 'application';
  }
};

const isSemanticAction = (call) => call?.class !== 'Route'
  && semanticMethods.has(call?.method);

const actionTarget = (call) => call.method === 'goto'
  ? pageLabel(call.params?.url)
  : selectorLabel(call.params?.selector) || 'the visible control';

const actionNarration = (call, outcome) => {
  const target = actionTarget(call);
  const observed = outcome ? selectorLabel(outcome.params?.selector) : '';
  const confirmation = observed
    ? ` The following assertion confirms that “${observed}” is visible.`
    : '';
  switch (call.method) {
    case 'goto':
      return `The test opens the “${target}” page to establish the starting state.${confirmation}`;
    case 'click':
    case 'dblclick':
      return `The test selects “${target}”.${confirmation}`;
    case 'fill':
    case 'type':
      return `The test enters text into “${target}”; the recorded value is intentionally omitted.${confirmation}`;
    case 'press':
      return `The test presses a key in “${target}”; the recorded key value is intentionally omitted.${confirmation}`;
    case 'check':
      return `The test enables “${target}”.${confirmation}`;
    case 'uncheck':
      return `The test disables “${target}”.${confirmation}`;
    case 'selectOption':
      return `The test chooses an option from “${target}”; the recorded value is intentionally omitted.${confirmation}`;
    case 'setInputFiles':
      return `The test attaches a file through “${target}”; file details are intentionally omitted.${confirmation}`;
    default:
      return `The test interacts with “${target}”.${confirmation}`;
  }
};

const tourNarration = (call, calls) => {
  const testEvents = new Map(calls
    .filter((candidate) => candidate?.class === 'Test')
    .flatMap((candidate) => {
      const id = candidate.stepId ?? candidate.callId;
      return id ? [[id, candidate]] : [];
    }));
  let stepId = call.stepId;
  for (let depth = 0; stepId && depth < 12; depth += 1) {
    const event = testEvents.get(stepId);
    if (!event) return '';
    if (event.method === 'test.step' && typeof event.title === 'string') {
      const match = event.title.match(/^Tour(?:\s+\[([^\]]+)\])?:\s*(.+)$/u);
      return match ? {
        stepId,
        title: match[1]?.trim().slice(0, 80),
        spoken: match[2].trim().slice(0, 320),
      } : undefined;
    }
    stepId = event.parentId;
  }
  return undefined;
};

const actionScenes = ({ pageId, pageFrames, calls, framePath }) => {
  const scenes = [];
  const narratedTourSteps = new Set();
  for (const [index, call] of calls.entries()) {
    if (!isSemanticAction(call) || call.pageId !== pageId) continue;
    const tour = tourNarration(call, calls);
    if (tour && narratedTourSteps.has(tour.stepId)) continue;
    if (tour) narratedTourSteps.add(tour.stepId);
    const following = calls.slice(index + 1);
    const nextSemanticIndex = following.findIndex(isSemanticAction);
    const beforeNextAction = following.slice(
      0,
      nextSemanticIndex < 0 ? following.length : nextSemanticIndex,
    );
    const outcome = beforeNextAction
      .find((candidate) => candidate.pageId === pageId && candidate.method === 'waitForSelector');
    const nextSemantic = nextSemanticIndex < 0 ? undefined : following[nextSemanticIndex];
    const stableFrames = pageFrames.filter((candidate) => (
      candidate.timestamp >= (call.endTime ?? call.startTime)
      && (!nextSemantic || candidate.timestamp < nextSemantic.startTime)
    ));
    const frame = stableFrames.at(-1)
      ?? pageFrames.find((candidate) => candidate.timestamp >= (call.endTime ?? call.startTime))
      ?? pageFrames.at(-1);
    const eventIds = [call.callId, outcome?.callId].filter(Boolean);
    const speakerNotes = tour?.spoken ?? '';
    scenes.push({
      id: `action-${String(call.callId).replaceAll(/[^a-z0-9]+/giu, '-')}`,
      title: tour?.title || `${call.method} ${actionTarget(call)}`,
      frame,
      spoken: speakerNotes || actionNarration(call, outcome),
      sourceTimeSeconds: Math.max(0, (
        call.startTime - (pageFrames[0]?.timestamp ?? call.startTime)
      ) / 1000),
      ...(speakerNotes ? { narrationSource: 'playwright-tour-step' } : {}),
      evidence: {
        pageId,
        frame: frame ? framePath(frame) : undefined,
        eventIds,
      },
    });
    if (scenes.length === 12) break;
  }
  return scenes;
};

export function buildTraceScenes({
  pageId,
  pageFrames,
  calls,
  actionErrors,
  sourceDuration,
  framePath,
}) {
  const observedErrors = errorPhrase(actionErrors.length);
  const behaviorScenes = actionScenes({ pageId, pageFrames, calls, framePath });
  const scenes = [{
    id: 'summary',
    title: 'Agent Workload Platform',
    frame: behaviorScenes[0]?.frame ?? pageFrames.at(0),
    sourceTimeSeconds: 0,
    spoken: `This developer walkthrough follows ${behaviorScenes.length} user-visible ${behaviorScenes.length === 1 ? 'interaction' : 'interactions'} from a Playwright trace with ${pageFrames.length} screenshots and ${observedErrors}.`,
    evidence: {
      pageId,
      frame: behaviorScenes[0]?.evidence.frame ?? (pageFrames[0] ? framePath(pageFrames[0]) : undefined),
      eventIds: calls.slice(0, 1).map((event) => event.callId).filter(Boolean),
    },
  }];

  if (behaviorScenes.length) return [...scenes, ...behaviorScenes];

  const mobileFrame = pageFrames.find((frame) => frame.width <= 480);
  const desktopFrame = [...pageFrames].reverse().find((frame) => frame.width >= 1024);

  if (mobileFrame) {
    scenes.push({
      id: 'mobile',
      title: 'Captured phone viewport',
      frame: mobileFrame,
      spoken: `The trace captured a phone-sized viewport at ${mobileFrame.width} by ${mobileFrame.height} pixels. This frame is direct visual evidence from the recording.`,
      evidence: { pageId, frame: framePath(mobileFrame), eventIds: [] },
    });
  }

  if (desktopFrame && desktopFrame !== mobileFrame) {
    scenes.push({
      id: 'desktop',
      title: 'Captured desktop viewport',
      frame: desktopFrame,
      spoken: `The trace captured a desktop viewport at ${desktopFrame.width} by ${desktopFrame.height} pixels. The recording contains ${observedErrors}.`,
      evidence: { pageId, frame: framePath(desktopFrame), eventIds: [] },
    });
  }

  if (!mobileFrame && !desktopFrame) {
    const representativeFrame = pageFrames.at(-1);
    scenes.push({
      id: 'page',
      title: 'Captured page',
      frame: representativeFrame,
      spoken: `This captured page frame is ${representativeFrame.width} by ${representativeFrame.height} pixels. The recording contains ${observedErrors}.`,
      evidence: { pageId, frame: framePath(representativeFrame), eventIds: [] },
    });
  }

  return scenes;
}

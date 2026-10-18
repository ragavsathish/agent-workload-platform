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
    .replaceAll(/\s+/gu, ' '), 90);
  return scenes.map((scene, index) => index === 0
    ? (() => {
        const introduction = `The requested explanation is: “${focus}”. `;
        return {
          ...scene,
          spoken: `${introduction}${boundedWords(scene.spoken, 320 - introduction.length)}`,
        };
      })()
    : scene);
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

const actionScenes = ({ pageId, pageFrames, calls, framePath }) => {
  const scenes = [];
  for (const [index, call] of calls.entries()) {
    if (!isSemanticAction(call) || call.pageId !== pageId) continue;
    const following = calls.slice(index + 1);
    const outcome = following
      .slice(0, following.findIndex(isSemanticAction) < 0
        ? following.length
        : following.findIndex(isSemanticAction))
      .find((candidate) => candidate.pageId === pageId && candidate.method === 'waitForSelector');
    const frame = pageFrames.find((candidate) => candidate.timestamp >= call.startTime)
      ?? pageFrames.at(-1);
    const eventIds = [call.callId, outcome?.callId].filter(Boolean);
    scenes.push({
      id: `action-${String(call.callId).replaceAll(/[^a-z0-9]+/giu, '-')}`,
      title: `${call.method} ${actionTarget(call)}`,
      frame,
      spoken: actionNarration(call, outcome),
      evidence: {
        pageId,
        frame: frame ? framePath(frame) : undefined,
        eventIds,
      },
    });
    if (scenes.length === 8) break;
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
    title: 'Trace overview',
    spoken: `This developer walkthrough follows ${behaviorScenes.length} user-visible ${behaviorScenes.length === 1 ? 'interaction' : 'interactions'} from a Playwright trace with ${pageFrames.length} screenshots and ${observedErrors}.`,
    evidence: { pageId, eventIds: calls.slice(0, 1).map((event) => event.callId).filter(Boolean) },
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

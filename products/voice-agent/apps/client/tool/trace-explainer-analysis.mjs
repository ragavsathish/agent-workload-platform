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

const errorPhrase = (count) => count === 0
  ? 'no recorded Playwright action errors'
  : `${count} recorded Playwright action ${count === 1 ? 'error' : 'errors'}`;

export function buildTraceScenes({
  pageId,
  pageFrames,
  calls,
  actionErrors,
  sourceDuration,
  framePath,
}) {
  const observedErrors = errorPhrase(actionErrors.length);
  const scenes = [{
    id: 'summary',
    title: 'Trace overview',
    spoken: `This developer walkthrough summarizes a Playwright trace with ${pageFrames.length} screenshots across ${sourceDuration.toFixed(1)} seconds, ${calls.length} recorded browser actions, and ${observedErrors}.`,
    evidence: { pageId, eventIds: calls.slice(0, 1).map((event) => event.callId).filter(Boolean) },
  }];

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

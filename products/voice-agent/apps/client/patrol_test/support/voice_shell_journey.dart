sealed class VoiceShellCommand {
  const VoiceShellCommand();
}

final class ObservePhoneShell extends VoiceShellCommand {
  const ObservePhoneShell();
}

final class ObserveDesktopWorkspace extends VoiceShellCommand {
  const ObserveDesktopWorkspace();
}

final class OpenTranscriptPage extends VoiceShellCommand {
  const OpenTranscriptPage();
}

final class OpenSystemHealthPage extends VoiceShellCommand {
  const OpenSystemHealthPage();
}

const voiceShellJourney = <VoiceShellCommand>[
  ObservePhoneShell(),
  ObserveDesktopWorkspace(),
  OpenTranscriptPage(),
  OpenSystemHealthPage(),
];

sealed class VoiceShellEvent {
  const VoiceShellEvent();
}

final class PhoneShellObserved extends VoiceShellEvent {
  const PhoneShellObserved();
}

final class DesktopWorkspaceObserved extends VoiceShellEvent {
  const DesktopWorkspaceObserved();
}

final class TranscriptPageOpened extends VoiceShellEvent {
  const TranscriptPageOpened(this.view);

  final String? view;
}

final class SystemHealthPageOpened extends VoiceShellEvent {
  const SystemHealthPageOpened(this.path);

  final String path;
}

final class VoiceShellState {
  const VoiceShellState({
    this.phoneShellObserved = false,
    this.desktopWorkspaceObserved = false,
    this.transcriptView,
    this.systemHealthPath,
    this.events = const [],
  });

  final bool phoneShellObserved;
  final bool desktopWorkspaceObserved;
  final String? transcriptView;
  final String? systemHealthPath;
  final List<VoiceShellEvent> events;
}

VoiceShellState reduceVoiceShell(VoiceShellState state, VoiceShellEvent event) {
  final events = List<VoiceShellEvent>.unmodifiable([...state.events, event]);
  return switch (event) {
    PhoneShellObserved() => VoiceShellState(
      phoneShellObserved: true,
      desktopWorkspaceObserved: state.desktopWorkspaceObserved,
      transcriptView: state.transcriptView,
      systemHealthPath: state.systemHealthPath,
      events: events,
    ),
    DesktopWorkspaceObserved() => VoiceShellState(
      phoneShellObserved: state.phoneShellObserved,
      desktopWorkspaceObserved: true,
      transcriptView: state.transcriptView,
      systemHealthPath: state.systemHealthPath,
      events: events,
    ),
    TranscriptPageOpened(:final view) => VoiceShellState(
      phoneShellObserved: state.phoneShellObserved,
      desktopWorkspaceObserved: state.desktopWorkspaceObserved,
      transcriptView: view,
      systemHealthPath: state.systemHealthPath,
      events: events,
    ),
    SystemHealthPageOpened(:final path) => VoiceShellState(
      phoneShellObserved: state.phoneShellObserved,
      desktopWorkspaceObserved: state.desktopWorkspaceObserved,
      transcriptView: state.transcriptView,
      systemHealthPath: path,
      events: events,
    ),
  };
}

List<String> validateVoiceShell(VoiceShellState state) => [
  if (!state.phoneShellObserved) 'Phone voice shell was not observed.',
  if (!state.desktopWorkspaceObserved)
    'Desktop task workspace was not observed.',
  if (state.transcriptView != 'transcript')
    'Transcript navigation did not open the transcript view.',
  if (state.systemHealthPath !=
      '/metrics/d/voice-c4-heatmap/c4-operational-heat-map')
    'System navigation did not open the operational heat map.',
];

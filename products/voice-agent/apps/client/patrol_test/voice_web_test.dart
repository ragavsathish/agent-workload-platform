import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;

import 'support/journey.dart';
import 'support/voice_shell_journey.dart';

void main() {
  patrolTest('observes the responsive voice shell and navigation', ($) async {
    await $.platform.web.resizeWindow(size: const Size(390, 844));
    await $.pumpWidgetAndSettle(const app.VoiceAgentApp());

    final result =
        await runJourney<VoiceShellCommand, VoiceShellEvent, VoiceShellState>(
          patrol: $,
          commands: voiceShellJourney,
          initialState: const VoiceShellState(),
          interpret: _interpretVoiceShell,
          reduce: reduceVoiceShell,
        );

    switch (result) {
      case JourneyFailed<VoiceShellCommand, VoiceShellState>():
        fail('$result\n${result.stackTrace}');
      case JourneySucceeded<VoiceShellCommand, VoiceShellState>(:final state):
        final violations = validateVoiceShell(state);
        expect(violations, isEmpty, reason: violations.join('\n'));
    }
  });
}

Future<VoiceShellEvent> _interpretVoiceShell(
  PatrolIntegrationTester $,
  VoiceShellCommand command,
) => switch (command) {
  ObservePhoneShell() => _observePhoneShell($),
  ObserveDesktopWorkspace() => _observeDesktopWorkspace($),
  OpenTranscriptPage() => _openTranscriptPage($),
  OpenSystemHealthPage() => _openSystemHealthPage($),
};

Future<VoiceShellEvent> _observePhoneShell(PatrolIntegrationTester $) async {
  await $(const Key('voice-state')).waitUntilExists();
  await $(const Key('conversation-map-placeholder')).waitUntilExists();
  await $(const Key('start-conversation')).waitUntilExists();
  expect($('Private coding workspace'), findsNothing);
  return const PhoneShellObserved();
}

Future<VoiceShellEvent> _observeDesktopWorkspace(
  PatrolIntegrationTester $,
) async {
  await $.platform.web.resizeWindow(size: const Size(1440, 1000));
  await $('Private coding workspace').waitUntilVisible();
  await $(const Key('context-size')).waitUntilExists();
  return const DesktopWorkspaceObserved();
}

Future<VoiceShellEvent> _openTranscriptPage(PatrolIntegrationTester $) async {
  final popup = $.platform.web.waitForPopup();
  await $(const Key('open-transcript')).tap();
  final page = await popup;
  await $.platform.web.switchToPage(pageId: page);
  final url = Uri.parse(await $.platform.web.getCurrentPageUrl());
  await $.platform.web.closePage(pageId: page);
  await $.platform.web.switchToInitialPage();
  return TranscriptPageOpened(url.queryParameters['view']);
}

Future<VoiceShellEvent> _openSystemHealthPage(PatrolIntegrationTester $) async {
  final popup = $.platform.web.waitForPopup();
  await $(const Key('open-system-health')).tap();
  final page = await popup;
  await $.platform.web.switchToPage(pageId: page);
  final url = Uri.parse(await $.platform.web.getCurrentPageUrl());
  await $.platform.web.closePage(pageId: page);
  await $.platform.web.switchToInitialPage();
  return SystemHealthPageOpened(url.path);
}

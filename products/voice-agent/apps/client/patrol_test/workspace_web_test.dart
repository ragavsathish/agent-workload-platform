import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;
import 'package:web/web.dart' as web;

void main() {
  patrolTest('observes typed conversation and durable work through HTTP', (
    $,
  ) async {
    await $.platform.web.resizeWindow(size: const Size(390, 844));
    web.window.history.replaceState(null, '', '/?view=transcript');
    await $.pumpWidgetAndSettle(const app.VoiceAgentApp());
    expect(
      find.byKey(const Key('message-fixture-assistant')),
      findsOneWidget,
      reason:
          'A restored large mobile transcript must open at its latest entry.',
    );
    await $.platform.web.resizeWindow(size: const Size(1440, 1000));

    await _observeWorkspace($);
    await _viewHistoricalSession($, 'fixture-history');
    await _resumeHistoricalSession($, 'fixture-history');
    await _compactSessionContext($);
    await _completeTypedTurn($, 'Inspect the fixture');
    await _interruptTypedTurn($, 'Interrupt the fixture');
    await _openTaskBoard($);
    await _approveTaskProposal($, 'fixture-task');
    await _createAgentTask($, 'fixture-task-2', 'Publish the fixture report');
    await _cancelAgentTask($, 'fixture-task-2');
    await _inspectMobileSessionHistory($, 'fixture-live');
    await _startFreshVoiceSession($);
    await _completeFreshSessionTurn($, 'Start the fresh session');
  });
}

Future<void> _observeWorkspace(PatrolIntegrationTester $) async {
  await $(const Key('session-fixture-live')).waitUntilExists();
  await $(const Key('tool-activity-fixture-tool')).waitUntilExists();
  await $('read_workspace').waitUntilVisible();
  await $('Completed').waitUntilVisible();
  await $(const Key('message-fixture-assistant')).waitUntilExists();
  await $('Ready from the HTTP fixture.').waitUntilVisible();
  await $(const Key('diagram-fixture-assistant')).tap();
  await $(const Key('mcp-app-fixture-assistant')).waitUntilExists();
  expect($('Visual unavailable'), findsNothing);
  await $(const Key('message-fixture-slides')).waitUntilExists();
  await $('Requested slides ready.').waitUntilVisible();
  await $(const Key('diagram-fixture-slides')).tap();
  await $(const Key('mcp-app-fixture-slides')).waitUntilExists();
  expect($('Visual unavailable'), findsNothing);
  await $('1k / 8k').waitUntilVisible();
}

Future<void> _viewHistoricalSession(
  PatrolIntegrationTester $,
  String sessionId,
) async {
  await $(Key('session-$sessionId')).tap();
  await $(const Key('read-only-history')).waitUntilVisible();
  await $('How did the release go?').waitUntilVisible();
  await $('The release completed successfully.').waitUntilVisible();
  expect($(const Key('message-pi')), findsNothing);
  expect($(const Key('compact-session')), findsNothing);
}

Future<void> _resumeHistoricalSession(
  PatrolIntegrationTester $,
  String sessionId,
) async {
  await $(const Key('resume-session')).tap();
  await $('Connected to Pi session').waitUntilVisible();
  expect($(const Key('read-only-history')), findsNothing);
  await $('The release completed successfully.').waitUntilVisible();
  await $(const Key('message-pi')).waitUntilExists();
}

Future<void> _compactSessionContext(PatrolIntegrationTester $) async {
  await $(const Key('compact-session')).tap();
  await $('600 / 8k').waitUntilVisible();
}

Future<void> _completeTypedTurn(
  PatrolIntegrationTester $,
  String message,
) async {
  await $(const Key('message-pi')).enterText(message);
  await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
  await $('Inspecting the fixture…').waitUntilVisible();
  await $(const Key('stop-response')).waitUntilExists();
  await $('Fixture response to: $message').waitUntilVisible();
  await $(const Key('send-message')).waitUntilExists();
}

Future<void> _interruptTypedTurn(
  PatrolIntegrationTester $,
  String message,
) async {
  await $(const Key('message-pi')).tap();
  await $(const Key('message-pi')).enterText(message);
  await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
  await $('Inspecting the fixture…').waitUntilVisible();
  await $(const Key('stop-response')).tap();
  await $('Response stopped.').waitUntilVisible();
  await $(const Key('send-message')).waitUntilExists();
}

Future<void> _openTaskBoard(PatrolIntegrationTester $) async {
  await $(const Key('tasks-section')).tap();
  await $(const Key('task-fixture-task')).waitUntilVisible();
  await $('Review the fixture deployment').waitUntilVisible();
}

Future<void> _approveTaskProposal(
  PatrolIntegrationTester $,
  String taskId,
) async {
  await $(Key('approve-$taskId')).tap();
  await $('APPROVED').waitUntilVisible();
}

Future<void> _createAgentTask(
  PatrolIntegrationTester $,
  String taskId,
  String instruction,
) async {
  await $(const Key('new-task-board')).tap();
  await $(const Key('new-task-instruction')).enterText(instruction);
  await $(const Key('submit-new-task')).tap();
  await $(Key('task-$taskId')).waitUntilVisible();
  await $(instruction).waitUntilVisible();
}

Future<void> _cancelAgentTask(PatrolIntegrationTester $, String taskId) async {
  await $(Key('cancel-$taskId')).tap();
  await $('CANCELLED').waitUntilVisible();
}

Future<void> _inspectMobileSessionHistory(
  PatrolIntegrationTester $,
  String sessionId,
) async {
  await $.platform.web.resizeWindow(size: const Size(390, 844));
  await $(const Key('workspace-section-toggle')).tap();
  await $(const Key('session-history')).tap();
  await $(Key('session-$sessionId')).waitUntilVisible();
  await $(Key('session-$sessionId')).tap();
  await $(const Key('read-only-history')).waitUntilVisible();
  await $('Ready from the HTTP fixture.').waitUntilVisible();
  await $(const Key('return-live-session')).tap();
  await $(const Key('message-pi')).waitUntilExists();
}

Future<void> _startFreshVoiceSession(PatrolIntegrationTester $) async {
  await $.platform.web.resizeWindow(size: const Size(1440, 1000));
  await $(const Key('new-voice-session')).tap();
  await $(const Key('confirm-new-voice-session')).tap();
  await $('Continue with Pi').waitUntilVisible();
  await $(const Key('empty-conversation')).waitUntilExists();
  await $('Context unavailable').waitUntilVisible();
  await $(const Key('session-fixture-live')).waitUntilExists();
  await $(const Key('message-pi')).waitUntilExists();
}

Future<void> _completeFreshSessionTurn(
  PatrolIntegrationTester $,
  String message,
) async {
  await $(const Key('message-pi')).enterText(message);
  await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
  await $('Fixture response to: $message').waitUntilVisible();
}

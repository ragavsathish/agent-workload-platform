import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;
import 'package:web/web.dart' as web;

import 'support/journey.dart';
import 'support/workspace_journey.dart';

void main() {
  patrolTest('observes typed conversation and durable work through HTTP', (
    $,
  ) async {
    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    web.window.history.replaceState(null, '', '/?view=transcript');
    await $.pumpWidgetAndSettle(const app.VoiceAgentApp());

    final result =
        await runJourney<
          WorkspaceCommand,
          WorkspaceEvent,
          WorkspaceJourneyState
        >(
          patrol: $,
          commands: workspaceJourney,
          initialState: const WorkspaceJourneyState(),
          interpret: _interpretWorkspace,
          reduce: reduceWorkspaceJourney,
        );

    switch (result) {
      case JourneyFailed<WorkspaceCommand, WorkspaceJourneyState>():
        fail('$result\n${result.stackTrace}');
      case JourneySucceeded<WorkspaceCommand, WorkspaceJourneyState>(
        :final state,
      ):
        final violations = validateWorkspaceJourney(state);
        expect(violations, isEmpty, reason: violations.join('\n'));
    }
  });
}

Future<WorkspaceEvent> _interpretWorkspace(
  PatrolIntegrationTester $,
  WorkspaceCommand command,
) => switch (command) {
  ObserveWorkspace() => _observeWorkspace($),
  ViewHistoricalSession(:final sessionId) => _viewHistoricalSession(
    $,
    sessionId,
  ),
  ResumeHistoricalSession(:final sessionId) => _resumeHistoricalSession(
    $,
    sessionId,
  ),
  CompactSessionContext() => _compactSessionContext($),
  CompleteTypedTurn(:final message) => _completeTypedTurn($, message),
  InterruptTypedTurn(:final message) => _interruptTypedTurn($, message),
  OpenTaskBoard() => _openTaskBoard($),
  ApproveTaskProposal(:final taskId) => _approveTaskProposal($, taskId),
  CreateAgentTask(:final taskId, :final instruction) => _createAgentTask(
    $,
    taskId,
    instruction,
  ),
  CancelAgentTask(:final taskId) => _cancelAgentTask($, taskId),
  InspectMobileSessionHistory(:final sessionId) => _inspectMobileSessionHistory(
    $,
    sessionId,
  ),
  StartFreshVoiceSession() => _startFreshVoiceSession($),
  CompleteFreshSessionTurn(:final message) => _completeFreshSessionTurn(
    $,
    message,
  ),
};

Future<WorkspaceEvent> _observeWorkspace(PatrolIntegrationTester $) async {
  await $(const Key('conversation-section')).waitUntilExists();
  await $(const Key('tool-activity-fixture-tool')).waitUntilExists();
  await $('read_workspace').waitUntilVisible();
  await $('Completed').waitUntilVisible();
  await $(const Key('message-fixture-assistant')).waitUntilExists();
  await $('Ready from the HTTP fixture.').waitUntilVisible();
  await $('1k / 8k').waitUntilVisible();
  return const WorkspaceObserved();
}

Future<WorkspaceEvent> _viewHistoricalSession(
  PatrolIntegrationTester $,
  String sessionId,
) async {
  await $(Key('session-$sessionId')).tap();
  await $(const Key('read-only-history')).waitUntilVisible();
  await $('How did the release go?').waitUntilVisible();
  await $('The release completed successfully.').waitUntilVisible();
  expect($(const Key('message-pi')), findsNothing);
  expect($(const Key('compact-session')), findsNothing);
  return HistoricalSessionViewed(sessionId);
}

Future<WorkspaceEvent> _resumeHistoricalSession(
  PatrolIntegrationTester $,
  String sessionId,
) async {
  await $(const Key('resume-session')).tap();
  await $('Connected to Pi session').waitUntilVisible();
  expect($(const Key('read-only-history')), findsNothing);
  await $('The release completed successfully.').waitUntilVisible();
  await $(const Key('message-pi')).waitUntilExists();
  return HistoricalSessionResumed(sessionId);
}

Future<WorkspaceEvent> _compactSessionContext(PatrolIntegrationTester $) async {
  await $(const Key('compact-session')).tap();
  await $('600 / 8k').waitUntilVisible();
  return const SessionContextCompacted();
}

Future<WorkspaceEvent> _completeTypedTurn(
  PatrolIntegrationTester $,
  String message,
) async {
  await $(const Key('message-pi')).enterText(message);
  await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
  await $('Inspecting the fixture…').waitUntilVisible();
  await $(const Key('stop-response')).waitUntilExists();
  await $('Fixture response to: $message').waitUntilVisible();
  await $(const Key('send-message')).waitUntilExists();
  return TypedTurnCompleted(message);
}

Future<WorkspaceEvent> _interruptTypedTurn(
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
  return TypedTurnInterrupted(message);
}

Future<WorkspaceEvent> _openTaskBoard(PatrolIntegrationTester $) async {
  await $(const Key('tasks-section')).tap();
  await $(const Key('task-fixture-task')).waitUntilVisible();
  await $('Review the fixture deployment').waitUntilVisible();
  return const TaskBoardOpened();
}

Future<WorkspaceEvent> _approveTaskProposal(
  PatrolIntegrationTester $,
  String taskId,
) async {
  await $(Key('approve-$taskId')).tap();
  await $('APPROVED').waitUntilVisible();
  return TaskProposalApproved(taskId);
}

Future<WorkspaceEvent> _createAgentTask(
  PatrolIntegrationTester $,
  String taskId,
  String instruction,
) async {
  await $(const Key('new-task-board')).tap();
  await $(const Key('new-task-instruction')).enterText(instruction);
  await $(const Key('submit-new-task')).tap();
  await $(Key('task-$taskId')).waitUntilVisible();
  await $(instruction).waitUntilVisible();
  return AgentTaskCreated(taskId);
}

Future<WorkspaceEvent> _cancelAgentTask(
  PatrolIntegrationTester $,
  String taskId,
) async {
  await $(Key('cancel-$taskId')).tap();
  await $('CANCELLED').waitUntilVisible();
  return AgentTaskCancelled(taskId);
}

Future<WorkspaceEvent> _inspectMobileSessionHistory(
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
  return MobileSessionHistoryInspected(sessionId);
}

Future<WorkspaceEvent> _startFreshVoiceSession(
  PatrolIntegrationTester $,
) async {
  await $.platform.web.resizeWindow(size: const Size(1440, 1000));
  await $(const Key('new-voice-session')).tap();
  await $(const Key('confirm-new-voice-session')).tap();
  await $('Continue with Pi').waitUntilVisible();
  await $(const Key('empty-conversation')).waitUntilExists();
  await $('Context unavailable').waitUntilVisible();
  await $(const Key('session-fixture-live')).waitUntilExists();
  await $(const Key('message-pi')).waitUntilExists();
  return const FreshVoiceSessionStarted();
}

Future<WorkspaceEvent> _completeFreshSessionTurn(
  PatrolIntegrationTester $,
  String message,
) async {
  await $(const Key('message-pi')).enterText(message);
  await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
  await $('Fixture response to: $message').waitUntilVisible();
  return FreshSessionTurnCompleted(message);
}

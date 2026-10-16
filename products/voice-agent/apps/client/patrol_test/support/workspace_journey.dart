sealed class WorkspaceCommand {
  const WorkspaceCommand();
}

final class ObserveWorkspace extends WorkspaceCommand {
  const ObserveWorkspace();
}

final class ViewHistoricalSession extends WorkspaceCommand {
  const ViewHistoricalSession(this.sessionId);

  final String sessionId;
}

final class ResumeHistoricalSession extends WorkspaceCommand {
  const ResumeHistoricalSession(this.sessionId);

  final String sessionId;
}

final class CompactSessionContext extends WorkspaceCommand {
  const CompactSessionContext();
}

final class CompleteTypedTurn extends WorkspaceCommand {
  const CompleteTypedTurn(this.message);

  final String message;
}

final class InterruptTypedTurn extends WorkspaceCommand {
  const InterruptTypedTurn(this.message);

  final String message;
}

final class OpenTaskBoard extends WorkspaceCommand {
  const OpenTaskBoard();
}

final class ApproveTaskProposal extends WorkspaceCommand {
  const ApproveTaskProposal(this.taskId);

  final String taskId;
}

final class CreateAgentTask extends WorkspaceCommand {
  const CreateAgentTask({required this.taskId, required this.instruction});

  final String taskId;
  final String instruction;
}

final class CancelAgentTask extends WorkspaceCommand {
  const CancelAgentTask(this.taskId);

  final String taskId;
}

final class InspectMobileSessionHistory extends WorkspaceCommand {
  const InspectMobileSessionHistory(this.sessionId);

  final String sessionId;
}

final class StartFreshVoiceSession extends WorkspaceCommand {
  const StartFreshVoiceSession();
}

final class CompleteFreshSessionTurn extends WorkspaceCommand {
  const CompleteFreshSessionTurn(this.message);

  final String message;
}

const workspaceJourney = <WorkspaceCommand>[
  ObserveWorkspace(),
  ViewHistoricalSession('fixture-history'),
  ResumeHistoricalSession('fixture-history'),
  CompactSessionContext(),
  CompleteTypedTurn('Inspect the fixture'),
  InterruptTypedTurn('Interrupt the fixture'),
  OpenTaskBoard(),
  ApproveTaskProposal('fixture-task'),
  CreateAgentTask(
    taskId: 'fixture-task-2',
    instruction: 'Publish the fixture report',
  ),
  CancelAgentTask('fixture-task-2'),
  InspectMobileSessionHistory('fixture-live'),
  StartFreshVoiceSession(),
  CompleteFreshSessionTurn('Start the fresh session'),
];

sealed class WorkspaceEvent {
  const WorkspaceEvent();
}

final class WorkspaceObserved extends WorkspaceEvent {
  const WorkspaceObserved();
}

final class HistoricalSessionViewed extends WorkspaceEvent {
  const HistoricalSessionViewed(this.sessionId);

  final String sessionId;
}

final class HistoricalSessionResumed extends WorkspaceEvent {
  const HistoricalSessionResumed(this.sessionId);

  final String sessionId;
}

final class SessionContextCompacted extends WorkspaceEvent {
  const SessionContextCompacted();
}

final class TypedTurnCompleted extends WorkspaceEvent {
  const TypedTurnCompleted(this.message);

  final String message;
}

final class TypedTurnInterrupted extends WorkspaceEvent {
  const TypedTurnInterrupted(this.message);

  final String message;
}

final class TaskBoardOpened extends WorkspaceEvent {
  const TaskBoardOpened();
}

final class TaskProposalApproved extends WorkspaceEvent {
  const TaskProposalApproved(this.taskId);

  final String taskId;
}

final class AgentTaskCreated extends WorkspaceEvent {
  const AgentTaskCreated(this.taskId);

  final String taskId;
}

final class AgentTaskCancelled extends WorkspaceEvent {
  const AgentTaskCancelled(this.taskId);

  final String taskId;
}

final class MobileSessionHistoryInspected extends WorkspaceEvent {
  const MobileSessionHistoryInspected(this.sessionId);

  final String sessionId;
}

final class FreshVoiceSessionStarted extends WorkspaceEvent {
  const FreshVoiceSessionStarted();
}

final class FreshSessionTurnCompleted extends WorkspaceEvent {
  const FreshSessionTurnCompleted(this.message);

  final String message;
}

final class WorkspaceJourneyState {
  const WorkspaceJourneyState({
    this.workspaceObserved = false,
    this.viewedSessionId,
    this.resumedSessionId,
    this.contextCompacted = false,
    this.completedTurns = const [],
    this.interruptedTurns = const [],
    this.taskBoardOpened = false,
    this.approvedTaskId,
    this.createdTaskId,
    this.cancelledTaskId,
    this.mobileHistorySessionId,
    this.freshSessionStarted = false,
    this.freshTurnCompleted = false,
    this.events = const [],
  });

  final bool workspaceObserved;
  final String? viewedSessionId;
  final String? resumedSessionId;
  final bool contextCompacted;
  final List<String> completedTurns;
  final List<String> interruptedTurns;
  final bool taskBoardOpened;
  final String? approvedTaskId;
  final String? createdTaskId;
  final String? cancelledTaskId;
  final String? mobileHistorySessionId;
  final bool freshSessionStarted;
  final bool freshTurnCompleted;
  final List<WorkspaceEvent> events;
}

WorkspaceJourneyState reduceWorkspaceJourney(
  WorkspaceJourneyState state,
  WorkspaceEvent event,
) {
  final events = List<WorkspaceEvent>.unmodifiable([...state.events, event]);
  final completedTurns = switch (event) {
    TypedTurnCompleted(:final message) => List<String>.unmodifiable([
      ...state.completedTurns,
      message,
    ]),
    _ => state.completedTurns,
  };
  final interruptedTurns = switch (event) {
    TypedTurnInterrupted(:final message) => List<String>.unmodifiable([
      ...state.interruptedTurns,
      message,
    ]),
    _ => state.interruptedTurns,
  };
  return WorkspaceJourneyState(
    workspaceObserved: state.workspaceObserved || event is WorkspaceObserved,
    viewedSessionId: switch (event) {
      HistoricalSessionViewed(:final sessionId) => sessionId,
      _ => state.viewedSessionId,
    },
    resumedSessionId: switch (event) {
      HistoricalSessionResumed(:final sessionId) => sessionId,
      _ => state.resumedSessionId,
    },
    contextCompacted:
        state.contextCompacted || event is SessionContextCompacted,
    completedTurns: completedTurns,
    interruptedTurns: interruptedTurns,
    taskBoardOpened: state.taskBoardOpened || event is TaskBoardOpened,
    approvedTaskId: switch (event) {
      TaskProposalApproved(:final taskId) => taskId,
      _ => state.approvedTaskId,
    },
    createdTaskId: switch (event) {
      AgentTaskCreated(:final taskId) => taskId,
      _ => state.createdTaskId,
    },
    cancelledTaskId: switch (event) {
      AgentTaskCancelled(:final taskId) => taskId,
      _ => state.cancelledTaskId,
    },
    mobileHistorySessionId: switch (event) {
      MobileSessionHistoryInspected(:final sessionId) => sessionId,
      _ => state.mobileHistorySessionId,
    },
    freshSessionStarted:
        state.freshSessionStarted || event is FreshVoiceSessionStarted,
    freshTurnCompleted:
        state.freshTurnCompleted || event is FreshSessionTurnCompleted,
    events: events,
  );
}

List<String> validateWorkspaceJourney(WorkspaceJourneyState state) => [
  if (!state.workspaceObserved) 'Workspace was not observed.',
  if (state.viewedSessionId == null) 'Historical session was not viewed.',
  if (state.resumedSessionId != state.viewedSessionId)
    'Viewed historical session was not the resumed session.',
  if (!state.contextCompacted) 'Session context was not compacted.',
  if (state.completedTurns.isEmpty) 'No typed turn completed.',
  if (state.interruptedTurns.isEmpty) 'No typed turn was interrupted.',
  if (!state.taskBoardOpened) 'Task board was not opened.',
  if (state.approvedTaskId == null) 'Task Proposal was not approved.',
  if (state.createdTaskId == null) 'Agent Task was not created.',
  if (state.cancelledTaskId != state.createdTaskId)
    'Created Agent Task was not the cancelled task.',
  if (state.mobileHistorySessionId == null)
    'Mobile Voice Session history was not inspected.',
  if (!state.freshSessionStarted) 'Fresh Voice Session was not started.',
  if (!state.freshTurnCompleted) 'Fresh Voice Session Turn did not complete.',
];

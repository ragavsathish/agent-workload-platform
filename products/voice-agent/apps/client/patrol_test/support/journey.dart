import 'package:patrol/patrol.dart';

typedef JourneyInterpreter<Command, Event> = Future<Event> Function(
  PatrolIntegrationTester patrol,
  Command command,
);
typedef JourneyReducer<State, Event> = State Function(State state, Event event);

sealed class JourneyResult<Command, State> {
  const JourneyResult();
}

final class JourneySucceeded<Command, State>
    extends JourneyResult<Command, State> {
  const JourneySucceeded(this.state);

  final State state;
}

final class JourneyFailed<Command, State>
    extends JourneyResult<Command, State> {
  const JourneyFailed({
    required this.command,
    required this.state,
    required this.error,
    required this.stackTrace,
  });

  final Command command;
  final State state;
  final Object error;
  final StackTrace stackTrace;

  @override
  String toString() => '${command.runtimeType}: $error';
}

Future<JourneyResult<Command, State>> runJourney<Command, Event, State>({
  required PatrolIntegrationTester patrol,
  required Iterable<Command> commands,
  required State initialState,
  required JourneyInterpreter<Command, Event> interpret,
  required JourneyReducer<State, Event> reduce,
}) async {
  var state = initialState;
  for (final command in commands) {
    try {
      final event = await interpret(patrol, command);
      state = reduce(state, event);
    } on Object catch (error, stackTrace) {
      return JourneyFailed(
        command: command,
        state: state,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
  return JourneySucceeded(state);
}

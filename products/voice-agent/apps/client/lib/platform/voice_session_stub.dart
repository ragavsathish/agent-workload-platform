import 'dart:async';

import 'voice_session.dart';

VoiceSession createVoiceSession() => _UnsupportedVoiceSession();

class _UnsupportedVoiceSession implements VoiceSession {
  final _events = StreamController<VoiceEvent>.broadcast();

  @override
  Stream<VoiceEvent> get events => _events.stream;

  @override
  Future<void> connect() async => throw UnsupportedError(
    'The native Pipecat transport adapter is not installed yet.',
  );

  @override
  Future<void> disconnect() async {}

  @override
  void setMuted(bool muted) {}

  @override
  void dispose() => _events.close();
}

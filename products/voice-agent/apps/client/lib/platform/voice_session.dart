import 'voice_session_stub.dart'
    if (dart.library.js_interop) 'voice_session_web.dart'
    as platform;

enum VoiceEventType {
  connected,
  disconnected,
  ready,
  muted,
  thinking,
  speaking,
  mermaid,
  audioOutput,
  audioError,
  transport,
}

class VoiceEvent {
  const VoiceEvent(
    this.type, {
    this.active,
    this.diagram,
    this.message,
    this.state,
  });

  final VoiceEventType type;
  final bool? active;
  final String? diagram;
  final String? message;
  final String? state;
}

abstract interface class VoiceSession {
  Stream<VoiceEvent> get events;

  Future<void> connect();

  void setMuted(bool muted);

  Future<void> disconnect();

  void dispose();
}

VoiceSession createVoiceSession() => platform.createVoiceSession();

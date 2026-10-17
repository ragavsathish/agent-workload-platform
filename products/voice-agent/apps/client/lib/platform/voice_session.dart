import '../models.dart';

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
  mcpApp,
  audioOutput,
  audioError,
  transport,
}

class VoiceEvent {
  const VoiceEvent(
    this.type, {
    this.active,
    this.presentation,
    this.resourceUri,
    this.message,
    this.state,
  });

  final VoiceEventType type;
  final bool? active;
  final JsonMap? presentation;
  final String? resourceUri;
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

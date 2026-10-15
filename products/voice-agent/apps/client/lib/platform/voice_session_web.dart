import 'dart:async';
import 'dart:convert';

import '../browser_bridge.dart';
import '../models.dart';
import 'voice_session.dart';

VoiceSession createVoiceSession() => _WebVoiceSession();

class _WebVoiceSession implements VoiceSession {
  _WebVoiceSession() {
    _eventTimer = Timer.periodic(
      const Duration(milliseconds: 120),
      (_) => _consumeEvents(),
    );
  }

  final _events = StreamController<VoiceEvent>.broadcast();
  Timer? _eventTimer;

  @override
  Stream<VoiceEvent> get events => _events.stream;

  @override
  Future<void> connect() => BrowserBridge.startVoice();

  @override
  Future<void> disconnect() => BrowserBridge.stopVoice();

  @override
  void setMuted(bool muted) => BrowserBridge.setMuted(muted);

  void _consumeEvents() {
    final raw = BrowserBridge.consumeEvents();
    if (raw == '[]' || _events.isClosed) return;
    try {
      final values = jsonDecode(raw) as List;
      for (final value in values) {
        final event = asMap(value);
        final type = switch (event['type']) {
          'connected' => VoiceEventType.connected,
          'disconnected' => VoiceEventType.disconnected,
          'ready' => VoiceEventType.ready,
          'muted' => VoiceEventType.muted,
          'thinking' => VoiceEventType.thinking,
          'speaking' => VoiceEventType.speaking,
          'mermaid' => VoiceEventType.mermaid,
          'audio-output' => VoiceEventType.audioOutput,
          'audio-error' => VoiceEventType.audioError,
          'transport' => VoiceEventType.transport,
          _ => null,
        };
        if (type == null) continue;
        _events.add(
          VoiceEvent(
            type,
            active: event['active'] as bool?,
            diagram: event['diagram'] as String?,
            message: event['message'] as String?,
            state: event['state'] as String?,
          ),
        );
      }
    } on Object {
      // A malformed browser event must not terminate the session event stream.
    }
  }

  @override
  void dispose() {
    _eventTimer?.cancel();
    _events.close();
  }
}

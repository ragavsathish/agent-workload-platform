@JS()
library;

import 'dart:js_interop';

@JS('voiceBridge.start')
external JSPromise<JSAny?> _startVoice();

@JS('voiceBridge.stop')
external JSPromise<JSAny?> _stopVoice();

@JS('voiceBridge.setMuted')
external void _setMuted(JSBoolean muted);

@JS('voiceBridge.consumeEvents')
external JSString _consumeEvents();

@JS('voiceBridge.mountMcpApp')
external JSPromise<JSString> _mountMcpApp(
  JSString elementId,
  JSString presentation,
  JSString resourceUri,
);

@JS('voiceBridge.openView')
external void _openView(JSString view);

@JS('voiceBridge.openExternalUrl')
external void _openExternalUrl(JSString url);

@JS('voiceBridge.playSpeech')
external JSPromise<JSAny?> _playSpeech(JSString spoken, JSString endpoint);

@JS('voiceBridge.playUrl')
external JSPromise<JSAny?> _playUrl(JSString url);

@JS('voiceBridge.stopSpeech')
external void _stopSpeech();

abstract final class BrowserBridge {
  static Future<void> startVoice() async => _startVoice().toDart;

  static Future<void> stopVoice() async => _stopVoice().toDart;

  static void setMuted(bool muted) => _setMuted(muted.toJS);

  static String consumeEvents() => _consumeEvents().toDart;

  static Future<String> mountMcpApp(
    String elementId,
    String presentation,
    String resourceUri,
  ) async => (await _mountMcpApp(
    elementId.toJS,
    presentation.toJS,
    resourceUri.toJS,
  ).toDart).toDart;

  static void openView(String view) => _openView(view.toJS);

  static void openExternalUrl(String url) => _openExternalUrl(url.toJS);

  static Future<void> playSpeech(
    String spoken, {
    required String endpoint,
  }) async => _playSpeech(spoken.toJS, endpoint.toJS).toDart;

  static Future<void> playUrl(String url) async => _playUrl(url.toJS).toDart;

  static void stopSpeech() => _stopSpeech();
}

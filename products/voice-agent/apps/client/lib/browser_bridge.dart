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

@JS('voiceBridge.renderMermaid')
external JSPromise<JSString> _renderMermaid(
  JSString elementId,
  JSString source,
);

@JS('voiceBridge.openView')
external void _openView(JSString view);

@JS('voiceBridge.playSpeech')
external JSPromise<JSAny?> _playSpeech(JSString spoken, JSString endpoint);

@JS('voiceBridge.playUrl')
external JSPromise<JSAny?> _playUrl(JSString url);

abstract final class BrowserBridge {
  static Future<void> startVoice() async => _startVoice().toDart;

  static Future<void> stopVoice() async => _stopVoice().toDart;

  static void setMuted(bool muted) => _setMuted(muted.toJS);

  static String consumeEvents() => _consumeEvents().toDart;

  static Future<String> renderMermaid(String elementId, String source) async =>
      (await _renderMermaid(elementId.toJS, source.toJS).toDart).toDart;

  static void openView(String view) => _openView(view.toJS);

  static Future<void> playSpeech(
    String spoken, {
    required String endpoint,
  }) async => _playSpeech(spoken.toJS, endpoint.toJS).toDart;

  static Future<void> playUrl(String url) async => _playUrl(url.toJS).toDart;
}

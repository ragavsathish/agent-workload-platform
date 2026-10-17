import '../browser_bridge.dart';

void openView(String view) => BrowserBridge.openView(view);

Future<void> playSpeech(String spoken, {required String endpoint}) =>
    BrowserBridge.playSpeech(spoken, endpoint: endpoint);

Future<void> playUrl(String url) => BrowserBridge.playUrl(url);

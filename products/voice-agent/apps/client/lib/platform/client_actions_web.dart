import '../browser_bridge.dart';

void openView(String view) => BrowserBridge.openView(view);

void openExternalUrl(String url) => BrowserBridge.openExternalUrl(url);

void openTaskArtifactUrl(String url) => BrowserBridge.openTaskArtifactUrl(url);

Future<void> playSpeech(String spoken, {required String endpoint}) =>
    BrowserBridge.playSpeech(spoken, endpoint: endpoint);

Future<void> playUrl(String url) => BrowserBridge.playUrl(url);

void stopSpeech() => BrowserBridge.stopSpeech();

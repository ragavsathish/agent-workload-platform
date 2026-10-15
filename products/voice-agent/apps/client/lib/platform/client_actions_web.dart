import '../browser_bridge.dart';

void openView(String view) => BrowserBridge.openView(view);

Future<void> playSpeech(String spoken) => BrowserBridge.playSpeech(spoken);

Future<void> playUrl(String url) => BrowserBridge.playUrl(url);

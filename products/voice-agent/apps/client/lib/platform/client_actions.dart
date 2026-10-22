import 'client_actions_stub.dart'
    if (dart.library.js_interop) 'client_actions_web.dart'
    as platform;

abstract final class ClientActions {
  static void openView(String view) => platform.openView(view);

  static void openExternalUrl(String url) => platform.openExternalUrl(url);

  static void openTaskArtifactUrl(String url) =>
      platform.openTaskArtifactUrl(url);

  static Future<void> playSpeech(String spoken, {required String endpoint}) =>
      platform.playSpeech(spoken, endpoint: endpoint);

  static Future<void> playUrl(String url) => platform.playUrl(url);

  static void stopSpeech() => platform.stopSpeech();
}

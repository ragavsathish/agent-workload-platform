import 'client_actions_stub.dart'
    if (dart.library.js_interop) 'client_actions_web.dart'
    as platform;

abstract final class ClientActions {
  static void openView(String view) => platform.openView(view);

  static Future<void> playSpeech(String spoken) => platform.playSpeech(spoken);

  static Future<void> playUrl(String url) => platform.playUrl(url);
}

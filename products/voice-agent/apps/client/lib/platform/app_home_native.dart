import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../api_client.dart';
import '../views/embedded_voice_web_view.dart';
import 'app_home_local.dart' as local;

Widget buildAppHome({required VoiceApi api, required String? view}) {
  if (defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS) {
    return const EmbeddedVoiceWebView();
  }
  return local.buildAppHome(api: api, view: view);
}

void openView(String view) =>
    throw UnsupportedError('Native navigation is not installed yet.');

void openExternalUrl(String url) =>
    throw UnsupportedError('External navigation is not installed yet.');

void openTaskArtifactUrl(String url) =>
    throw UnsupportedError('Artifact downloads are not installed yet.');

Future<void> playSpeech(String spoken, {required String endpoint}) async =>
    throw UnsupportedError('Native speech playback is not installed yet.');

Future<void> playUrl(String url) async =>
    throw UnsupportedError('Native audio playback is not installed yet.');

void stopSpeech() {}

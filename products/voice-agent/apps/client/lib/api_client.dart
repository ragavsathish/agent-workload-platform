import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';
import 'platform/embedded_navigation_policy.dart';

class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class VoiceApi {
  VoiceApi({http.Client? client}) : _client = client ?? http.Client();
  static const _configuredOrigin = String.fromEnvironment('VOICE_API_ORIGIN');
  final http.Client _client;

  Uri _uri(String path) => _configuredOrigin.isEmpty
      ? Uri.base.resolve(path)
      : Uri.parse(_configuredOrigin).resolve(path);

  /// Resolves non-JSON browser resources against the same API origin.
  Uri endpoint(String path) => _uri(path);

  /// Owner-only download served over the configured Tailscale HTTPS origin.
  Uri taskArtifactUrl(String taskId, String name) {
    final origin = Uri.parse(defaultVoiceWorkspaceUrl);
    if (origin.scheme != 'https' || !origin.host.endsWith('.ts.net')) {
      throw const ApiException('Tailscale HTTPS URL is not configured.');
    }
    return Uri(
      scheme: 'https',
      host: origin.host,
      port: origin.hasPort ? origin.port : null,
      pathSegments: ['api', 'tasks', taskId, 'artifacts', name],
    );
  }

  Future<JsonMap> _json(
    String path, {
    String method = 'GET',
    Object? body,
  }) async {
    final uri = _uri(path);
    final headers = body == null
        ? <String, String>{}
        : {'Content-Type': 'application/json'};
    final response = method == 'POST'
        ? await _client.post(
            uri,
            headers: headers,
            body: body == null ? null : jsonEncode(body),
          )
        : await _client.get(uri, headers: {'Cache-Control': 'no-store'});
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      decoded = null;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        '${asMap(decoded)['detail'] ?? 'Request failed (${response.statusCode})'}',
      );
    }
    return asMap(decoded);
  }

  Future<ContextUsage> context() async =>
      ContextUsage.fromJson(await _json('/api/pi-context'));
  Future<ContextUsage> compact() async => ContextUsage.fromJson(
    await _json('/api/pi-context/compact', method: 'POST'),
  );
  Future<TranscriptSnapshot> transcript() async =>
      TranscriptSnapshot.fromJson(await _json('/api/pi-transcript'));
  Future<List<PiSessionSummary>> sessions() async {
    final body = await _json('/api/pi-sessions');
    return (body['sessions'] as List? ?? const [])
        .map((value) => PiSessionSummary.fromJson(asMap(value)))
        .toList(growable: false);
  }

  Future<TranscriptSnapshot> sessionTranscript(String id) async =>
      TranscriptSnapshot.fromJson(
        await _json('/api/pi-sessions/${Uri.encodeComponent(id)}'),
      );

  Future<void> newSession() async {
    await _json('/api/pi-sessions/new', method: 'POST');
  }

  Future<void> resumeSession(String id) async {
    await _json(
      '/api/pi-sessions/${Uri.encodeComponent(id)}/resume',
      method: 'POST',
    );
  }

  Future<VisualResponse> sendMessage(String message) async {
    final body = await _json(
      '/api/pi-message',
      method: 'POST',
      body: {'message': message},
    );
    return VisualResponse.fromValue(body) ??
        (throw const ApiException('Pi returned an invalid response.'));
  }

  Future<void> stopTurn() async {
    await _json('/api/pi-turn/abort', method: 'POST');
  }

  Future<List<AgentTask>> tasks() async {
    final response = await _client.get(
      _uri('/api/tasks'),
      headers: {'Cache-Control': 'no-store'},
    );
    if (response.statusCode != 200) {
      throw const ApiException('Tasks are unavailable.');
    }
    final body = jsonDecode(response.body);
    if (body is! List) {
      throw const ApiException('Tasks returned an invalid response.');
    }
    return body
        .map((v) => AgentTask.fromJson(asMap(v)))
        .toList(growable: false);
  }

  Future<AgentTask> createTask(String instruction) async => AgentTask.fromJson(
    await _json(
      '/api/tasks',
      method: 'POST',
      body: {'instruction': instruction},
    ),
  );

  Future<List<TaskProgressEvent>> taskProgress(
    String id, {
    int after = 0,
  }) async {
    final response = await _client.get(
      _uri('/api/tasks/${Uri.encodeComponent(id)}/progress?after=$after'),
      headers: {'Cache-Control': 'no-store'},
    );
    if (response.statusCode != 200) {
      throw const ApiException('Task progress is unavailable.');
    }
    final body = jsonDecode(response.body);
    if (body is! List) {
      throw const ApiException('Task progress returned an invalid response.');
    }
    return body
        .map((value) => TaskProgressEvent.fromJson(asMap(value)))
        .toList(growable: false);
  }

  Future<void> taskAction(String id, String action) async => _json(
    '/api/tasks/${Uri.encodeComponent(id)}/$action',
    method: 'POST',
    body: const {},
  );

  void close() => _client.close();
}

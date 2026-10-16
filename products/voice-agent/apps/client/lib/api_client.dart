import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  const ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

class VoiceApi {
  VoiceApi({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;

  Future<JsonMap> _json(
    String path, {
    String method = 'GET',
    Object? body,
  }) async {
    final uri = Uri.base.resolve(path);
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
  Future<VisualResponse> sendMessage(String message) async {
    final body = await _json(
      '/api/pi-message',
      method: 'POST',
      body: {'message': message},
    );
    return VisualResponse.fromValue(body) ??
        (throw const ApiException('Pi returned an invalid response.'));
  }

  Future<List<AgentTask>> tasks() async {
    final response = await _client.get(
      Uri.base.resolve('/api/tasks'),
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

  Future<void> taskAction(String id, String action) async => _json(
    '/api/tasks/${Uri.encodeComponent(id)}/$action',
    method: 'POST',
    body: const {},
  );

  void close() => _client.close();
}

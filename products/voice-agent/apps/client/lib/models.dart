import 'dart:convert';

typedef JsonMap = Map<String, dynamic>;

JsonMap asMap(Object? value) =>
    value is Map<String, dynamic> ? value : const {};

Object? decodeModelJson(String value) {
  var candidate = value.trim();
  for (var removedBraces = 0; removedBraces <= 2; removedBraces++) {
    try {
      return jsonDecode(candidate);
    } on FormatException {
      if (!candidate.endsWith('}') || removedBraces == 2) return null;
      candidate = candidate.substring(0, candidate.length - 1).trimRight();
    }
  }
  return null;
}

class VisualResponse {
  const VisualResponse({
    required this.spoken,
    required this.presentation,
    this.resourceUri = 'ui://mermaid/main',
  });

  final String spoken;
  final JsonMap presentation;
  final String resourceUri;

  static VisualResponse? fromValue(Object? value) {
    Object? decoded = value;
    for (var depth = 0; depth < 4; depth++) {
      final decodedMap = asMap(decoded);
      if (decodedMap.isNotEmpty) {
        final nested = decodedMap['spoken'];
        if (nested is! String) break;
        final nestedDecoded = decodeModelJson(nested);
        final nestedMap = asMap(nestedDecoded);
        if (nestedMap['presentation'] is! Map<String, dynamic>) break;
        decoded = nestedDecoded;
        continue;
      }
      if (decoded is! String) break;
      decoded = decodeModelJson(decoded);
      if (decoded == null) return null;
    }
    final body = asMap(decoded);
    final spoken = body['spoken'];
    final presentation = asMap(body['presentation']);
    final resourceUri = body['resourceUri'];
    final inferredResourceUri = switch (presentation['kind']) {
      'excalidraw' => 'ui://excalidraw/mcp-app.html',
      'slides' => 'ui://slides/marp.html',
      'playwright-trace-viewer' => 'ui://playwright-trace-viewer/main.html',
      'journal-review' => 'ui://journal-review/main.html',
      'grafana-trace' => 'ui://grafana/trace.html',
      _ => 'ui://mermaid/main',
    };
    return spoken is String && presentation.isNotEmpty
        ? VisualResponse(
            spoken: spoken,
            presentation: presentation,
            resourceUri: resourceUri is String
                ? resourceUri
                : inferredResourceUri,
          )
        : null;
  }
}

class ContextUsage {
  const ContextUsage({
    required this.tokens,
    required this.contextWindow,
    required this.percent,
    required this.estimated,
    required this.canCompact,
  });

  final int? tokens;
  final int? contextWindow;
  final double? percent;
  final bool estimated;
  final bool canCompact;

  factory ContextUsage.fromJson(JsonMap json) => ContextUsage(
    tokens: (json['tokens'] as num?)?.toInt(),
    contextWindow: (json['contextWindow'] as num?)?.toInt(),
    percent: (json['percent'] as num?)?.toDouble(),
    estimated: json['estimated'] == true,
    canCompact: json['canCompact'] == true,
  );
}

class TranscriptEntry {
  const TranscriptEntry({
    required this.id,
    required this.timestamp,
    required this.role,
    required this.text,
    this.status,
  });

  final String id;
  final int timestamp;
  final String role;
  final String text;
  final String? status;

  factory TranscriptEntry.fromJson(JsonMap json) => TranscriptEntry(
    id: '${json['id'] ?? ''}',
    timestamp: (json['timestamp'] as num?)?.toInt() ?? 0,
    role: '${json['role'] ?? 'tool'}',
    text: '${json['text'] ?? ''}',
    status: json['status'] as String?,
  );
}

class TranscriptSnapshot {
  const TranscriptSnapshot({required this.revision, required this.entries});

  final int revision;
  final List<TranscriptEntry> entries;

  VisualResponse? get latestVisualResponse {
    for (final entry in entries.reversed) {
      if (entry.role != 'assistant' || entry.status == 'streaming') continue;
      final response = VisualResponse.fromValue(entry.text);
      if (response != null) return response;
    }
    return null;
  }

  factory TranscriptSnapshot.fromJson(JsonMap json) => TranscriptSnapshot(
    revision: (json['revision'] as num?)?.toInt() ?? 0,
    entries: (json['entries'] as List? ?? const [])
        .map((value) => TranscriptEntry.fromJson(asMap(value)))
        .toList(growable: false),
  );
}

class PiSessionSummary {
  const PiSessionSummary({
    required this.id,
    required this.title,
    required this.updatedAt,
    required this.messageCount,
    required this.active,
  });

  final String id;
  final String title;
  final DateTime updatedAt;
  final int messageCount;
  final bool active;

  factory PiSessionSummary.fromJson(JsonMap json) => PiSessionSummary(
    id: '${json['id'] ?? ''}',
    title: '${json['title'] ?? 'Untitled session'}',
    updatedAt:
        DateTime.tryParse('${json['updatedAt'] ?? ''}') ??
        DateTime.fromMillisecondsSinceEpoch(0),
    messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
    active: json['active'] == true,
  );
}

class AgentTask {
  const AgentTask({
    required this.id,
    required this.instruction,
    required this.workspace,
    required this.planHash,
    required this.status,
    required this.createdAt,
    required this.state,
    this.sessionName,
    this.sessionArtist,
    this.sessionSpotifyUrl,
    this.response,
    this.artifacts = const [],
    this.failure,
  });

  final String id;
  final String instruction;
  final String workspace;
  final String planHash;
  final String status;
  final DateTime createdAt;
  final String state;
  final String? sessionName;
  final String? sessionArtist;
  final String? sessionSpotifyUrl;
  final VisualResponse? response;
  final List<String> artifacts;
  final Object? failure;

  bool get isActive =>
      status == 'pending' ||
      const {'pending', 'running', 'sleeping'}.contains(state);

  factory AgentTask.fromJson(JsonMap json) {
    final result = asMap(json['result']);
    final output = asMap(result['result']);
    final sessionReference = asMap(json['session_reference']);
    return AgentTask(
      id: '${json['id'] ?? ''}',
      instruction: '${json['instruction'] ?? ''}',
      workspace: '${json['workspace'] ?? ''}',
      planHash: '${json['plan_hash'] ?? ''}',
      status: '${json['status'] ?? 'pending'}',
      createdAt:
          DateTime.tryParse('${json['created_at'] ?? ''}') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      state: result.isEmpty
          ? '${json['status'] ?? 'pending'}'
          : '${result['state'] ?? 'pending'}',
      sessionName: json['session_name'] as String?,
      sessionArtist: sessionReference['artist'] as String?,
      sessionSpotifyUrl: sessionReference['spotify_url'] as String?,
      response: VisualResponse.fromValue(output['response']),
      artifacts: (output['artifacts'] as List? ?? const [])
          .map((v) => '$v')
          .toList(),
      failure: result['failure'],
    );
  }
}

class TaskProgressEvent {
  const TaskProgressEvent({required this.id, required this.spoken});

  final int id;
  final String spoken;

  factory TaskProgressEvent.fromJson(JsonMap json) => TaskProgressEvent(
    id: (json['id'] as num?)?.toInt() ?? 0,
    spoken: '${json['spoken'] ?? ''}',
  );
}

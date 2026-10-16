import 'dart:convert';

typedef JsonMap = Map<String, dynamic>;

JsonMap asMap(Object? value) =>
    value is Map<String, dynamic> ? value : const {};

class VisualResponse {
  const VisualResponse({required this.spoken, required this.mermaid});

  final String spoken;
  final String mermaid;

  static VisualResponse? fromValue(Object? value) {
    JsonMap body;
    if (value is String) {
      try {
        body = asMap(jsonDecode(value));
      } on FormatException {
        return null;
      }
    } else {
      body = asMap(value);
    }
    final spoken = body['spoken'];
    final mermaid = body['mermaid'];
    return spoken is String && mermaid is String
        ? VisualResponse(spoken: spoken, mermaid: mermaid)
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
  final VisualResponse? response;
  final List<String> artifacts;
  final Object? failure;

  bool get isActive =>
      status == 'pending' ||
      (status == 'approved' && state == 'approved') ||
      const {'pending', 'running', 'sleeping'}.contains(state);

  factory AgentTask.fromJson(JsonMap json) {
    final result = asMap(json['result']);
    final output = asMap(result['result']);
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
      response: VisualResponse.fromValue(output['response']),
      artifacts: (output['artifacts'] as List? ?? const [])
          .map((v) => '$v')
          .toList(),
      failure: result['failure'],
    );
  }
}

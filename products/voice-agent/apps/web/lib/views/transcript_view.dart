import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../browser_bridge.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/mermaid_view.dart';

enum TimelineFilter { all, chat, tasks }

sealed class TimelineItem {
  const TimelineItem(this.timestamp);
  final int timestamp;
}

class TranscriptItem extends TimelineItem {
  TranscriptItem(this.entry) : super(entry.timestamp);
  final TranscriptEntry entry;
}

class TaskItem extends TimelineItem {
  TaskItem(this.task) : super(task.createdAt.millisecondsSinceEpoch);
  final AgentTask task;
}

class TranscriptView extends StatefulWidget {
  const TranscriptView({required this.api, super.key});
  final VoiceApi api;

  @override
  State<TranscriptView> createState() => _TranscriptViewState();
}

class _TranscriptViewState extends State<TranscriptView> {
  final _message = TextEditingController();
  final _scroll = ScrollController();
  TranscriptSnapshot _snapshot = const TranscriptSnapshot(revision: 0, entries: []);
  List<AgentTask> _tasks = const [];
  TimelineFilter _filter = TimelineFilter.all;
  final Set<String> _expanded = {};
  Timer? _transcriptTimer;
  Timer? _taskTimer;
  bool _live = true;
  bool _sending = false;
  String? _error;
  String? _taskBusy;

  @override
  void initState() {
    super.initState();
    _pollTranscript();
    _pollTasks();
    _transcriptTimer = Timer.periodic(const Duration(milliseconds: 750), (_) => _pollTranscript());
    _taskTimer = Timer.periodic(const Duration(seconds: 4), (_) => _pollTasks());
  }

  @override
  void dispose() {
    _transcriptTimer?.cancel();
    _taskTimer?.cancel();
    _message.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _pollTranscript() async {
    try {
      final next = await widget.api.transcript();
      if (mounted && next.revision != _snapshot.revision) {
        setState(() { _snapshot = next; _live = true; });
        _scrollToEnd();
      } else if (mounted) {
        setState(() => _live = true);
      }
    } on Object {
      if (mounted) setState(() => _live = false);
    }
  }

  Future<void> _pollTasks() async {
    try {
      final next = await widget.api.tasks();
      if (mounted) setState(() => _tasks = next);
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  void _scrollToEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  });

  Future<void> _send() async {
    final content = _message.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() { _sending = true; _error = null; });
    try {
      final response = await widget.api.sendMessage(content);
      _message.clear();
      await BrowserBridge.playSpeech(response.spoken);
      await _pollTranscript();
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _act(AgentTask task, String action) async {
    setState(() { _taskBusy = task.id; _error = null; });
    try {
      await widget.api.taskAction(task.id, action);
      await _pollTasks();
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _taskBusy = null);
    }
  }

  List<AgentTask> get _visibleTasks => _tasks.indexed
      .where((item) => item.$1 < 10 || item.$2.isActive)
      .map((item) => item.$2)
      .toList(growable: false);

  List<TimelineItem> get _timeline {
    final values = <TimelineItem>[
      ..._snapshot.entries.map(TranscriptItem.new),
      ..._visibleTasks.map(TaskItem.new),
    ]..sort((left, right) => left.timestamp.compareTo(right.timestamp));
    return values.where((item) => switch (_filter) {
      TimelineFilter.all => true,
      TimelineFilter.chat => item is TranscriptItem,
      TimelineFilter.tasks => item is TaskItem,
    }).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 980),
          child: Column(children: [
            _TranscriptHeader(
              live: _live,
              filter: _filter,
              taskCount: _visibleTasks.length,
              onFilter: (value) => setState(() => _filter = value),
            ),
            if (_error != null) Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
              color: PiColors.danger.withValues(alpha: .12),
              child: Text(_error!, key: const Key('timeline-error'), style: const TextStyle(color: PiColors.danger)),
            ),
            Expanded(
              child: _timeline.isEmpty
                  ? Center(child: Text(_filter == TimelineFilter.tasks ? 'No tasks yet.' : 'Ask Pi by voice or type below.', style: const TextStyle(color: PiColors.muted)))
                  : ListView.builder(
                      key: const Key('timeline-list'),
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
                      itemCount: _timeline.length,
                      itemBuilder: (_, index) {
                        final item = _timeline[index];
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: item is TaskItem ? _taskCard(item.task) : _transcriptCard((item as TranscriptItem).entry),
                        );
                      },
                    ),
            ),
            _Composer(controller: _message, sending: _sending, onSend: _send),
          ]),
        ),
      ),
    ),
  );

  Widget _transcriptCard(TranscriptEntry entry) {
    final visual = entry.role == 'assistant' && entry.status != 'running'
        ? VisualResponse.fromValue(entry.text)
        : null;
    final isExpanded = _expanded.contains(entry.id);
    return SurfaceCard(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _Meta(role: entry.role == 'assistant' ? 'Pi' : entry.role, timestamp: entry.timestamp, status: entry.status),
        const SizedBox(height: 10),
        if (entry.role == 'assistant' && entry.status == 'running')
          const Text('Pi is responding…', style: TextStyle(color: PiColors.green))
        else
          Text(visual?.spoken ?? entry.text, style: entry.role == 'tool' ? const TextStyle(fontFamily: 'monospace', color: PiColors.muted) : null),
        if (visual != null) ...[
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            OutlinedButton(
              key: Key('diagram-${entry.id}'),
              onPressed: () => setState(() => isExpanded ? _expanded.remove(entry.id) : _expanded.add(entry.id)),
              child: Text(isExpanded ? 'Hide diagram' : 'Show diagram'),
            ),
            OutlinedButton(onPressed: () => BrowserBridge.playSpeech(visual.spoken), child: const Text('Listen again')),
          ]),
          if (isExpanded) Padding(padding: const EdgeInsets.only(top: 12), child: MermaidView(diagram: visual.mermaid, height: 300)),
        ],
      ]),
    );
  }

  Widget _taskCard(AgentTask task) {
    final id = 'task:${task.id}';
    final isExpanded = _expanded.contains(id);
    return Container(
      key: Key('task-${task.id}'),
      decoration: BoxDecoration(color: PiColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: PiColors.blue.withValues(alpha: .55))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            _Meta(role: 'Task', timestamp: task.createdAt.millisecondsSinceEpoch, status: task.state),
            const SizedBox(height: 10),
            Text(task.instruction, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 8),
            Text(task.workspace, style: const TextStyle(fontFamily: 'monospace', color: PiColors.muted, fontSize: 12)),
            if (task.response != null) ...[
              const SizedBox(height: 12),
              Text(task.response!.spoken),
              const SizedBox(height: 10),
              Wrap(spacing: 8, children: [
                OutlinedButton(
                  onPressed: () => setState(() => isExpanded ? _expanded.remove(id) : _expanded.add(id)),
                  child: Text(isExpanded ? 'Hide diagram' : 'Show diagram'),
                ),
                OutlinedButton(
                  onPressed: () => BrowserBridge.playUrl('/api/tasks/${Uri.encodeComponent(task.id)}/speech'),
                  child: const Text('Listen again'),
                ),
              ]),
              if (isExpanded) MermaidView(diagram: task.response!.mermaid, height: 300),
            ],
          ]),
        ),
        ExpansionTile(
          title: const Text('Integrity & output', style: TextStyle(fontSize: 13)),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText('Plan SHA-256: ${task.planHash}', style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
            if (task.artifacts.isNotEmpty) SelectableText('Artifacts: ${task.artifacts.join(', ')}'),
            if (task.failure != null) SelectableText(const JsonEncoder.withIndent('  ').convert(task.failure)),
          ],
        ),
        if (task.isActive)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(children: [
              if (task.status == 'pending') ...[
                ElevatedButton(onPressed: _taskBusy == task.id ? null : () => _act(task, 'approve'), child: const Text('Approve')),
                const SizedBox(width: 8),
              ],
              OutlinedButton(onPressed: _taskBusy == task.id ? null : () => _act(task, 'cancel'), child: const Text('Cancel')),
            ]),
          ),
      ]),
    );
  }
}

class _TranscriptHeader extends StatelessWidget {
  const _TranscriptHeader({required this.live, required this.filter, required this.taskCount, required this.onFilter});
  final bool live;
  final TimelineFilter filter;
  final int taskCount;
  final ValueChanged<TimelineFilter> onFilter;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(18, 18, 18, 14),
    decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: PiColors.border))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Eyebrow('Pi session'),
          Text('Chat & tasks', style: Theme.of(context).textTheme.headlineMedium),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(color: PiColors.surfaceRaised, borderRadius: BorderRadius.circular(18)),
          child: Text(live ? '●  Live' : '○  Reconnecting', style: TextStyle(color: live ? PiColors.green : PiColors.orange)),
        ),
      ]),
      const SizedBox(height: 12),
      SegmentedButton<TimelineFilter>(
        key: const Key('timeline-filter'),
        segments: [
          const ButtonSegment(value: TimelineFilter.all, label: Text('All')),
          const ButtonSegment(value: TimelineFilter.chat, label: Text('Chat')),
          ButtonSegment(value: TimelineFilter.tasks, label: Text('Tasks $taskCount')),
        ],
        selected: {filter},
        onSelectionChanged: (values) => onFilter(values.first),
      ),
    ]),
  );
}

class _Meta extends StatelessWidget {
  const _Meta({required this.role, required this.timestamp, this.status});
  final String role;
  final int timestamp;
  final String? status;

  @override
  Widget build(BuildContext context) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp).toLocal();
    final clock = '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}:${date.second.toString().padLeft(2, '0')}';
    return Wrap(spacing: 10, crossAxisAlignment: WrapCrossAlignment.center, children: [
      Text(role, style: const TextStyle(fontWeight: FontWeight.w700, color: PiColors.green)),
      Text(clock, style: Theme.of(context).textTheme.bodySmall),
      if (status != null) Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(color: PiColors.surfaceRaised, borderRadius: BorderRadius.circular(8)),
        child: Text(status!, style: Theme.of(context).textTheme.bodySmall),
      ),
    ]);
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.sending, required this.onSend});
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
    decoration: const BoxDecoration(color: PiColors.background, border: Border(top: BorderSide(color: PiColors.border))),
    child: Column(children: [
      Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Expanded(child: TextField(
          key: const Key('message-pi'),
          controller: controller,
          enabled: !sending,
          minLines: 1,
          maxLines: 5,
          maxLength: 8000,
          buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
          textInputAction: TextInputAction.send,
          onSubmitted: (_) => onSend(),
          decoration: const InputDecoration(hintText: 'Message Pi…'),
        )),
        const SizedBox(width: 10),
        IconButton.filled(
          key: const Key('send-message'),
          onPressed: sending ? null : onSend,
          icon: sending
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.send_rounded),
          tooltip: 'Send message',
        ),
      ]),
      const SizedBox(height: 7),
      const Text('Tool arguments, credentials, and hidden reasoning are not displayed.', textAlign: TextAlign.center, style: TextStyle(color: PiColors.muted, fontSize: 11)),
    ]),
  );
}

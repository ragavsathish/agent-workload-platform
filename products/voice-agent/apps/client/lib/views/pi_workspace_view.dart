import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../design_icons.dart';
import '../design_tokens.dart';
import '../models.dart';
import '../platform/client_actions.dart';
import '../theme.dart';
import '../widgets/pi_app_header.dart';
import '../widgets/mcp_app_view.dart';

enum WorkspaceSection { conversation, tasks }

String summarizeTaskProgress(List<TaskProgressEvent> events) {
  final updates = events
      .map((event) => event.spoken.trim())
      .where(
        (spoken) =>
            spoken.isNotEmpty && spoken != 'The agent has started working.',
      )
      .toList();
  if (updates.isEmpty) return '';
  if (updates.length == 1) return updates.single;

  var commands = 0;
  var errors = 0;
  final details = <String>[];
  for (final spoken in updates) {
    if (spoken == 'The agent is running a workspace command.') {
      commands += 1;
      continue;
    }
    if (spoken ==
        'A task tool reported an error; the agent is checking what happened.') {
      errors += 1;
      continue;
    }
    if (details.isEmpty || details.last != spoken) details.add(spoken);
  }
  final summary = <String>[];
  if (commands > 0) {
    summary.add(
      'It ran $commands workspace ${commands == 1 ? 'command' : 'commands'}.',
    );
  }
  if (errors > 0) {
    summary.add(
      'It is checking $errors tool ${errors == 1 ? 'error' : 'errors'}.',
    );
  }
  if (details.isNotEmpty) {
    summary.addAll(
      details.length > 3 ? details.sublist(details.length - 3) : details,
    );
  }
  return summary.join(' ');
}

/// Pi Web-inspired session workspace for typed conversation and durable work.
///
/// This surface deliberately knows nothing about microphone state. VoiceView
/// remains the only owner of the live voice transport and controls.
class PiWorkspaceView extends StatefulWidget {
  const PiWorkspaceView({
    required this.api,
    this.playSpeech,
    this.onNavigateHome,
    super.key,
  });

  final VoiceApi api;
  final Future<void> Function(String spoken)? playSpeech;
  final VoidCallback? onNavigateHome;

  @override
  State<PiWorkspaceView> createState() => _PiWorkspaceViewState();
}

class _PiWorkspaceViewState extends State<PiWorkspaceView> {
  final _message = TextEditingController();
  final _scroll = ScrollController();
  final Set<String> _expanded = {};
  TranscriptSnapshot _snapshot = const TranscriptSnapshot(
    revision: 0,
    entries: [],
  );
  List<AgentTask> _tasks = const [];
  List<PiSessionSummary> _sessions = const [];
  PiSessionSummary? _selectedSession;
  TranscriptSnapshot? _historicalSnapshot;
  ContextUsage? _context;
  WorkspaceSection _section = WorkspaceSection.conversation;
  Timer? _transcriptTimer;
  Timer? _taskTimer;
  Timer? _contextTimer;
  Timer? _sessionTimer;
  bool _live = true;
  bool _sending = false;
  bool _stopping = false;
  bool _turnStopRequested = false;
  bool _compactBusy = false;
  bool _newSessionBusy = false;
  bool _resumeSessionBusy = false;
  String? _error;
  String? _playbackNotice;
  String? _taskBusy;
  String? _listeningTaskId;
  String? _latestTaskProgress;
  int _progressCursor = 0;
  int _narrationGeneration = 0;
  int? _progressPollingGeneration;
  int? _narrationPlayingGeneration;
  final List<TaskProgressEvent> _pendingTaskNarration = [];

  @override
  void initState() {
    super.initState();
    unawaited(_refreshAll());
    _transcriptTimer = Timer.periodic(
      const Duration(milliseconds: 750),
      (_) => _pollTranscript(),
    );
    _taskTimer = Timer.periodic(
      const Duration(seconds: 4),
      (_) => _pollTasks(),
    );
    _contextTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _pollContext(),
    );
    _sessionTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _pollSessions(),
    );
  }

  @override
  void dispose() {
    _transcriptTimer?.cancel();
    _taskTimer?.cancel();
    _contextTimer?.cancel();
    _sessionTimer?.cancel();
    ClientActions.stopSpeech();
    _message.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _refreshAll() async {
    await Future.wait([
      _pollTranscript(),
      _pollTasks(),
      _pollContext(),
      _pollSessions(),
    ]);
  }

  Future<void> _pollTranscript() async {
    try {
      final next = await widget.api.transcript();
      if (!mounted) return;
      final changed = next.revision != _snapshot.revision;
      if (changed || !_live) {
        setState(() {
          if (changed) _snapshot = next;
          _live = true;
        });
      }
      if (changed) _scrollToEnd();
    } on Object {
      if (mounted) setState(() => _live = false);
    }
  }

  Future<void> _pollTasks() async {
    try {
      final next = await widget.api.tasks();
      if (!mounted) return;
      setState(() => _tasks = next);
      final listening = next
          .where((task) => task.id == _listeningTaskId)
          .firstOrNull;
      if (listening != null && !listening.isActive) {
        await _pollTaskProgress();
      } else if (_section == WorkspaceSection.tasks &&
          _listeningTaskId != null) {
        unawaited(_pollTaskProgress());
      }
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _pollTaskProgress() async {
    final taskId = _listeningTaskId;
    final generation = _narrationGeneration;
    if (taskId == null ||
        _progressPollingGeneration == generation ||
        _section != WorkspaceSection.tasks) {
      return;
    }
    _progressPollingGeneration = generation;
    try {
      while (mounted &&
          taskId == _listeningTaskId &&
          generation == _narrationGeneration) {
        final events = await widget.api.taskProgress(
          taskId,
          after: _progressCursor,
        );
        if (!mounted ||
            taskId != _listeningTaskId ||
            generation != _narrationGeneration) {
          return;
        }
        if (events.isEmpty) break;
        final fresh = events
            .where((event) => event.id > _progressCursor)
            .toList();
        if (fresh.isEmpty) break;
        _pendingTaskNarration.addAll(
          fresh.where((event) => event.spoken.isNotEmpty),
        );
        setState(() => _progressCursor = fresh.last.id);
        final task = _tasks.where((item) => item.id == taskId).firstOrNull;
        if (events.length < 40 && (task == null || task.isActive)) break;
      }
    } on Object catch (error) {
      if (mounted && taskId == _listeningTaskId) {
        setState(
          () => _playbackNotice = 'Task narration is unavailable: $error',
        );
      }
    } finally {
      if (_progressPollingGeneration == generation) {
        _progressPollingGeneration = null;
      }
      if (mounted &&
          taskId == _listeningTaskId &&
          generation == _narrationGeneration &&
          _pendingTaskNarration.isNotEmpty) {
        unawaited(_drainTaskNarration());
      }
      final task = _tasks.where((item) => item.id == taskId).firstOrNull;
      if (task != null && !task.isActive) _finishTaskNarration(task);
    }
  }

  Future<void> _drainTaskNarration() async {
    final taskId = _listeningTaskId;
    final generation = _narrationGeneration;
    if (taskId == null ||
        _narrationPlayingGeneration == generation ||
        _pendingTaskNarration.isEmpty) {
      return;
    }
    _narrationPlayingGeneration = generation;
    try {
      while (mounted &&
          taskId == _listeningTaskId &&
          generation == _narrationGeneration &&
          _pendingTaskNarration.isNotEmpty) {
        final batch = _pendingTaskNarration.take(40).toList();
        _pendingTaskNarration.removeRange(0, batch.length);
        final fallback = summarizeTaskProgress(batch);
        if (fallback.isEmpty) continue;
        String spoken;
        try {
          spoken = await widget.api.narrateTaskProgress(
            taskId,
            after: batch.first.id - 1,
            through: batch.last.id,
          );
        } on Object {
          spoken = fallback;
        }
        if (!mounted ||
            taskId != _listeningTaskId ||
            generation != _narrationGeneration) {
          return;
        }
        if (spoken.isEmpty) continue;
        setState(() => _latestTaskProgress = spoken);
        if (!await _playTaskNarrationSpeech(spoken)) {
          if (mounted &&
              taskId == _listeningTaskId &&
              generation == _narrationGeneration) {
            _narrationGeneration += 1;
            setState(() => _listeningTaskId = null);
          }
          return;
        }
      }
    } finally {
      if (_narrationPlayingGeneration == generation) {
        _narrationPlayingGeneration = null;
      }
      final task = _tasks.where((item) => item.id == taskId).firstOrNull;
      if (task != null && !task.isActive) _finishTaskNarration(task);
    }
  }

  Future<bool> _playTaskNarrationSpeech(String spoken) async {
    try {
      if (widget.playSpeech case final playSpeech?) {
        await playSpeech(spoken);
      } else {
        await ClientActions.playSpeech(
          spoken,
          endpoint: widget.api.endpoint('/api/pi-speech').toString(),
        );
      }
      if (mounted) setState(() => _playbackNotice = null);
      return true;
    } on Object {
      if (mounted) {
        setState(
          () => _playbackNotice =
              'Task audio was blocked. Tap Listen to replay the updates.',
        );
      }
      return false;
    }
  }

  void _finishTaskNarration(AgentTask task) {
    if (!mounted ||
        _listeningTaskId != task.id ||
        _progressPollingGeneration == _narrationGeneration ||
        _narrationPlayingGeneration == _narrationGeneration ||
        _pendingTaskNarration.isNotEmpty) {
      return;
    }
    _narrationGeneration += 1;
    setState(() => _listeningTaskId = null);
    if (task.response case final response?) {
      unawaited(_playSpeech(response.spoken));
    }
  }

  void _toggleTaskNarration(AgentTask task) {
    _narrationGeneration += 1;
    if (_listeningTaskId == task.id) {
      ClientActions.stopSpeech();
      _pendingTaskNarration.clear();
      setState(() => _listeningTaskId = null);
      return;
    }
    ClientActions.stopSpeech();
    _pendingTaskNarration.clear();
    setState(() {
      _listeningTaskId = task.id;
      _latestTaskProgress = null;
      _progressCursor = 0;
      _playbackNotice = null;
    });
    unawaited(_pollTaskProgress());
  }

  void _changeSection(WorkspaceSection section) {
    if (section != WorkspaceSection.tasks && _listeningTaskId != null) {
      _narrationGeneration += 1;
      ClientActions.stopSpeech();
      _pendingTaskNarration.clear();
      _listeningTaskId = null;
    }
    setState(() => _section = section);
  }

  Future<void> _pollContext() async {
    try {
      final value = await widget.api.context();
      if (mounted) setState(() => _context = value);
    } on Object {
      // Context is supplementary; keep conversation and tasks usable.
    }
  }

  Future<void> _pollSessions() async {
    try {
      final value = await widget.api.sessions();
      if (mounted) setState(() => _sessions = value);
    } on Object {
      // History is supplementary; keep the live session usable.
    }
  }

  Future<void> _openSession(PiSessionSummary session) async {
    if (session.active) {
      _returnToLive();
      return;
    }
    setState(() {
      _error = null;
      _section = WorkspaceSection.conversation;
    });
    try {
      final snapshot = await widget.api.sessionTranscript(session.id);
      if (!mounted) return;
      setState(() {
        _selectedSession = session;
        _historicalSnapshot = snapshot;
        _expanded.clear();
      });
      _scrollToEnd();
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  void _returnToLive() => setState(() {
    _selectedSession = null;
    _historicalSnapshot = null;
    _section = WorkspaceSection.conversation;
    _expanded.clear();
  });

  Future<void> _resumeSelectedSession() async {
    final selected = _selectedSession;
    final historical = _historicalSnapshot;
    if (selected == null || historical == null || _resumeSessionBusy) return;
    setState(() {
      _resumeSessionBusy = true;
      _error = null;
    });
    try {
      await widget.api.resumeSession(selected.id);
      if (!mounted) return;
      setState(() {
        _snapshot = historical;
        _selectedSession = null;
        _historicalSnapshot = null;
        _context = null;
        _expanded.clear();
      });
      await Future.wait([_pollSessions(), _pollContext()]);
      _scrollToEnd();
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _resumeSessionBusy = false);
    }
  }

  Future<void> _showSessionHistory() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 20),
          children: [
            const _SidebarLabel('VOICE SESSIONS'),
            ..._sessions.map(
              (session) => _SessionRow(
                session: session,
                selected: session.active
                    ? _selectedSession == null
                    : _selectedSession?.id == session.id,
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  unawaited(_openSession(session));
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _newVoiceSession() async {
    if (_sending || _stopping || _newSessionBusy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Start a new Voice Session?'),
        content: const Text(
          'The current conversation stays in history. Voice and typed messages will continue in a fresh Pi context.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('confirm-new-voice-session'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Start fresh'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _newSessionBusy = true;
      _error = null;
    });
    try {
      await widget.api.newSession();
      if (!mounted) return;
      setState(() {
        _selectedSession = null;
        _historicalSnapshot = null;
        _snapshot = TranscriptSnapshot(
          revision: _snapshot.revision + 1,
          entries: const [],
        );
        _context = null;
        _section = WorkspaceSection.conversation;
        _expanded.clear();
      });
      await Future.wait([_pollSessions(), _pollContext()]);
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _newSessionBusy = false);
    }
  }

  void _scrollToEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.minScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    }
  });

  Future<void> _send() async {
    final content = _message.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _turnStopRequested = false;
      _error = null;
      _playbackNotice = null;
    });
    try {
      final response = await widget.api.sendMessage(content);
      if (_turnStopRequested) return;
      _message.clear();
      await _pollTranscript();
      unawaited(_playSpeech(response.spoken));
    } on Object catch (error) {
      if (mounted && !_turnStopRequested) setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
          _stopping = false;
        });
      }
    }
  }

  Future<void> _stopTurn() async {
    if (!_sending || _stopping) return;
    setState(() {
      _stopping = true;
      _turnStopRequested = true;
      _error = null;
    });
    try {
      await widget.api.stopTurn();
      _message.clear();
      await _pollTranscript();
      if (mounted) setState(() => _playbackNotice = 'Response stopped.');
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _turnStopRequested = false;
          _stopping = false;
          _error = '$error';
        });
      }
    }
  }

  Future<void> _compact() async {
    if (_compactBusy || _context?.canCompact != true) return;
    setState(() {
      _compactBusy = true;
      _error = null;
    });
    try {
      final value = await widget.api.compact();
      if (mounted) setState(() => _context = value);
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _compactBusy = false);
    }
  }

  Future<void> _playSpeech(String spoken) async {
    try {
      if (widget.playSpeech case final playSpeech?) {
        await playSpeech(spoken);
      } else {
        await ClientActions.playSpeech(
          spoken,
          endpoint: widget.api.endpoint('/api/pi-speech').toString(),
        );
      }
      if (mounted) setState(() => _playbackNotice = null);
    } on Object {
      if (mounted) {
        setState(
          () => _playbackNotice = 'Audio did not play automatically. Tap Listen again on the response.',
        );
      }
    }
  }

  Future<void> _playTask(AgentTask task) async {
    try {
      await ClientActions.playUrl(
        '/api/tasks/${Uri.encodeComponent(task.id)}/speech',
      );
      if (mounted) setState(() => _playbackNotice = null);
    } on Object {
      if (mounted) {
        setState(
          () => _playbackNotice =
              'Audio playback was blocked. Tap Listen again to retry.',
        );
      }
    }
  }

  Future<void> _act(AgentTask task, String action) async {
    setState(() {
      _taskBusy = task.id;
      _error = null;
    });
    try {
      await widget.api.taskAction(task.id, action);
      await _pollTasks();
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _taskBusy = null);
    }
  }

  Future<void> _createTask() async {
    final instruction = await showDialog<String>(
      context: context,
      builder: (_) => const _NewTaskDialog(),
    );
    if (instruction == null || instruction.isEmpty || !mounted) return;
    setState(() {
      _taskBusy = 'new';
      _error = null;
    });
    try {
      await widget.api.createTask(instruction);
      await _pollTasks();
      if (mounted) setState(() => _section = WorkspaceSection.tasks);
    } on Object catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _taskBusy = null);
    }
  }

  List<AgentTask> get _visibleTasks => _tasks.indexed
      .where((item) => item.$1 < 20 || item.$2.isActive)
      .map((item) => item.$2)
      .toList(growable: false);

  @override
  Widget build(BuildContext context) {
    final desktop = MediaQuery.sizeOf(context).width >= 840;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _WorkspaceHeader(
              live: _live,
              historicalTitle: _selectedSession?.title,
              section: _section,
              taskCount: _visibleTasks.length,
              desktop: desktop,
              onSection: _changeSection,
              onCreateTask: _taskBusy == 'new' ? null : _createTask,
              onHistory: _showSessionHistory,
              onNewSession: _newSessionBusy || _sending || _stopping
                  ? null
                  : _newVoiceSession,
              onNavigateHome:
                  widget.onNavigateHome ?? ClientActions.navigateHome,
            ),
            if (_error != null)
              _NoticeBanner(
                key: const Key('timeline-error'),
                text: _error!,
                danger: true,
                onDismiss: () => setState(() => _error = null),
              ),
            if (_playbackNotice != null)
              _NoticeBanner(
                key: const Key('playback-notice'),
                text: _playbackNotice!,
                onDismiss: () => setState(() => _playbackNotice = null),
              ),
            Expanded(
              child: desktop
                  ? Row(
                      children: [
                        SizedBox(
                          width: 286,
                          child: _WorkspaceSidebar(
                            section: _section,
                            sessions: _sessions,
                            selectedSessionId: _selectedSession?.id,
                            tasks: _visibleTasks,
                            onSection: _changeSection,
                            onSession: _openSession,
                          ),
                        ),
                        const VerticalDivider(width: 1),
                        Expanded(child: _activeView()),
                      ],
                    )
                  : _activeView(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _activeView() => switch (_section) {
    WorkspaceSection.conversation => _ConversationPane(
      entries: (_historicalSnapshot ?? _snapshot).entries,
      historicalTitle: _selectedSession?.title,
      scrollController: _scroll,
      messageController: _message,
      contextUsage: _context,
      sending: _sending,
      stopping: _stopping,
      compactBusy: _compactBusy,
      expanded: _expanded,
      onToggleDiagram: (id) => setState(
        () => _expanded.contains(id) ? _expanded.remove(id) : _expanded.add(id),
      ),
      onListen: _playSpeech,
      onSend: _send,
      onStop: _stopTurn,
      onCompact: _compact,
      onReturnLive: _returnToLive,
      onResume: _resumeSessionBusy ? null : _resumeSelectedSession,
    ),
    WorkspaceSection.tasks => _TaskBoard(
      api: widget.api,
      tasks: _visibleTasks,
      busyTask: _taskBusy,
      listeningTaskId: _listeningTaskId,
      latestTaskProgress: _latestTaskProgress,
      expanded: _expanded,
      onToggleDiagram: (id) => setState(
        () => _expanded.contains(id) ? _expanded.remove(id) : _expanded.add(id),
      ),
      onAction: _act,
      onListen: _playTask,
      onToggleNarration: _toggleTaskNarration,
      onCreate: _taskBusy == 'new' ? null : _createTask,
    ),
  };
}

class _WorkspaceHeader extends StatelessWidget {
  const _WorkspaceHeader({
    required this.live,
    required this.historicalTitle,
    required this.section,
    required this.taskCount,
    required this.desktop,
    required this.onSection,
    required this.onCreateTask,
    required this.onHistory,
    required this.onNewSession,
    required this.onNavigateHome,
  });

  final bool live;
  final String? historicalTitle;
  final WorkspaceSection section;
  final int taskCount;
  final bool desktop;
  final ValueChanged<WorkspaceSection> onSection;
  final VoidCallback? onCreateTask;
  final VoidCallback onHistory;
  final VoidCallback? onNewSession;
  final VoidCallback onNavigateHome;

  @override
  Widget build(BuildContext context) => PiAppHeader(
    child: Row(
      children: [
        Tooltip(
          message: 'Pi Voice home',
          child: InkWell(
            key: const Key('workspace-home'),
            onTap: onNavigateHome,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              width: 44,
              height: 44,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: PiColors.of(context).green.withValues(alpha: .13),
                border: Border.all(
                  color: PiColors.of(context).green.withValues(alpha: .5),
                ),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                'P',
                style: TextStyle(
                  color: PiColors.of(context).green,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                desktop
                    ? section == WorkspaceSection.conversation
                          ? 'Voice orchestrator'
                          : 'Task workspace'
                    : section == WorkspaceSection.conversation
                    ? 'Voice'
                    : 'Tasks',
                key: const Key('workspace-title'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                softWrap: false,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                historicalTitle != null
                    ? desktop
                          ? 'Read-only history · $historicalTitle'
                          : 'History · $historicalTitle'
                    : live
                    ? desktop
                          ? 'Connected to Pi session'
                          : 'Connected'
                    : 'Reconnecting…',
                key: const Key('workspace-status'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                softWrap: false,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
        if (!desktop)
          IconButton.outlined(
            key: const Key('new-voice-session'),
            tooltip: 'New Voice Session',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            onPressed: onNewSession,
            icon: const PiHeaderIcon(PiHeaderIcons.newSession),
          ),
        if (!desktop) const SizedBox(width: 7),
        if (!desktop)
          IconButton.outlined(
            key: const Key('session-history'),
            tooltip: 'Voice session history',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            onPressed: onHistory,
            icon: const PiHeaderIcon(PiHeaderIcons.history),
          ),
        if (!desktop) const ThemeToggleButton(),
        if (desktop) const SizedBox(width: 9),
        if (desktop) const ThemeToggleButton(),
        if (!desktop) const SizedBox(width: 7),
        if (!desktop)
          IconButton.outlined(
            key: const Key('workspace-section-toggle'),
            tooltip: section == WorkspaceSection.conversation
                ? 'Show tasks'
                : 'Show conversation',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            onPressed: () => onSection(
              section == WorkspaceSection.conversation
                  ? WorkspaceSection.tasks
                  : WorkspaceSection.conversation,
            ),
            icon: Badge(
              isLabelVisible:
                  taskCount > 0 && section == WorkspaceSection.conversation,
              label: Text('$taskCount'),
              child: Icon(
                section == WorkspaceSection.conversation
                    ? PiHeaderIcons.tasks
                    : PiHeaderIcons.chat,
                size: PiDesignTokens.iconSize,
              ),
            ),
          ),
        const SizedBox(width: 9),
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: live
                ? PiColors.of(context).green
                : PiColors.of(context).orange,
            shape: BoxShape.circle,
          ),
        ),
        if (desktop) ...[
          const SizedBox(width: 14),
          OutlinedButton.icon(
            key: const Key('new-voice-session'),
            onPressed: onNewSession,
            icon: const PiHeaderIcon(PiHeaderIcons.newSession),
            label: const Text('New session'),
          ),
          const SizedBox(width: 9),
          OutlinedButton.icon(
            key: const Key('new-task'),
            onPressed: onCreateTask,
            icon: const PiHeaderIcon(PiHeaderIcons.add),
            label: const Text('New task'),
          ),
        ],
      ],
    ),
  );
}

class _WorkspaceSidebar extends StatelessWidget {
  const _WorkspaceSidebar({
    required this.section,
    required this.sessions,
    required this.selectedSessionId,
    required this.tasks,
    required this.onSection,
    required this.onSession,
  });

  final WorkspaceSection section;
  final List<PiSessionSummary> sessions;
  final String? selectedSessionId;
  final List<AgentTask> tasks;
  final ValueChanged<WorkspaceSection> onSection;
  final ValueChanged<PiSessionSummary> onSession;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: PiColors.of(context).background,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 20),
      children: [
        const _SidebarLabel('VOICE SESSIONS'),
        if (sessions.isEmpty)
          _SidebarRow(
            key: const Key('conversation-section'),
            selected: section == WorkspaceSection.conversation,
            icon: Icons.chat_bubble_outline_rounded,
            title: 'Voice orchestrator',
            subtitle: 'Persistent Pi session',
            onTap: () => onSection(WorkspaceSection.conversation),
          )
        else
          ...sessions.map(
            (session) => _SessionRow(
              session: session,
              selected:
                  section == WorkspaceSection.conversation &&
                  (session.active
                      ? selectedSessionId == null
                      : selectedSessionId == session.id),
              onTap: () => onSession(session),
            ),
          ),
        const SizedBox(height: 20),
        const _SidebarLabel('DURABLE WORK'),
        _SidebarRow(
          key: const Key('tasks-section'),
          selected: section == WorkspaceSection.tasks,
          icon: Icons.task_alt_rounded,
          title: 'Tasks',
          subtitle: '${tasks.length} recent',
          onTap: () => onSection(WorkspaceSection.tasks),
        ),
        if (tasks.isNotEmpty) ...[
          const SizedBox(height: 8),
          ...tasks
              .take(6)
              .map(
                (task) => Padding(
                  padding: const EdgeInsets.fromLTRB(12, 5, 6, 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: _StateDot(state: task.state),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Text(
                          task.sessionName ?? task.instruction,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
        ],
      ],
    ),
  );
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({
    required this.session,
    required this.selected,
    required this.onTap,
  });

  final PiSessionSummary session;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => _SidebarRow(
    key: Key('session-${session.id}'),
    selected: selected,
    icon: session.active ? Icons.graphic_eq_rounded : Icons.history_rounded,
    title: session.active ? 'Voice orchestrator' : session.title,
    subtitle: session.active
        ? 'Live · ${session.messageCount} messages'
        : '${_relativeTime(session.updatedAt)} · ${session.messageCount} messages',
    onTap: onTap,
  );
}

class _SidebarLabel extends StatelessWidget {
  const _SidebarLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
    child: Text(
      text,
      style: TextStyle(
        color: PiColors.of(context).muted,
        fontSize: 10,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.3,
      ),
    ),
  );
}

class _SidebarRow extends StatelessWidget {
  const _SidebarRow({
    required this.selected,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    super.key,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: selected ? PiColors.of(context).surfaceRaised : Colors.transparent,
    borderRadius: BorderRadius.circular(10),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          children: [
            Icon(
              icon,
              size: 18,
              color: selected
                  ? PiColors.of(context).green
                  : PiColors.of(context).muted,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ConversationPane extends StatelessWidget {
  const _ConversationPane({
    required this.entries,
    required this.historicalTitle,
    required this.scrollController,
    required this.messageController,
    required this.contextUsage,
    required this.sending,
    required this.stopping,
    required this.compactBusy,
    required this.expanded,
    required this.onToggleDiagram,
    required this.onListen,
    required this.onSend,
    required this.onStop,
    required this.onCompact,
    required this.onReturnLive,
    required this.onResume,
  });

  final List<TranscriptEntry> entries;
  final String? historicalTitle;
  final ScrollController scrollController;
  final TextEditingController messageController;
  final ContextUsage? contextUsage;
  final bool sending;
  final bool stopping;
  final bool compactBusy;
  final Set<String> expanded;
  final ValueChanged<String> onToggleDiagram;
  final Future<void> Function(String) onListen;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final VoidCallback onCompact;
  final VoidCallback onReturnLive;
  final VoidCallback? onResume;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      if (historicalTitle != null)
        Container(
          key: const Key('read-only-history'),
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
          decoration: BoxDecoration(
            color: PiColors.of(context).surface,
            border: Border(
              bottom: BorderSide(color: PiColors.of(context).border),
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.lock_clock_outlined,
                size: 17,
                color: PiColors.of(context).muted,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Text(
                  'Read-only history · $historicalTitle',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              TextButton.icon(
                key: const Key('return-live-session'),
                onPressed: onReturnLive,
                icon: const Icon(Icons.graphic_eq_rounded, size: 16),
                label: Text(
                  MediaQuery.sizeOf(context).width < 480
                      ? 'Live'
                      : 'Back to live',
                ),
              ),
              const SizedBox(width: 6),
              FilledButton.icon(
                key: const Key('resume-session'),
                onPressed: onResume,
                icon: const Icon(Icons.play_arrow_rounded, size: 17),
                label: const Text('Resume'),
              ),
            ],
          ),
        ),
      Expanded(
        child: entries.isEmpty
            ? const _EmptyConversation()
            : ListView.builder(
                key: const Key('timeline-list'),
                controller: scrollController,
                reverse: true,
                padding: EdgeInsets.fromLTRB(
                  MediaQuery.sizeOf(context).width >= 840 ? 34 : 16,
                  24,
                  MediaQuery.sizeOf(context).width >= 840 ? 34 : 16,
                  28,
                ),
                itemCount: entries.length,
                itemBuilder: (_, index) {
                  final entry = entries[entries.length - index - 1];
                  return _MessageRow(
                    entry: entry,
                    diagramExpanded: expanded.contains(entry.id),
                    onToggleDiagram: () => onToggleDiagram(entry.id),
                    onListen: onListen,
                  );
                },
              ),
      ),
      if (historicalTitle == null)
        _Composer(
          controller: messageController,
          contextUsage: contextUsage,
          sending: sending,
          stopping: stopping,
          compactBusy: compactBusy,
          onSend: onSend,
          onStop: onStop,
          onCompact: onCompact,
        ),
    ],
  );
}

class _EmptyConversation extends StatelessWidget {
  const _EmptyConversation();

  @override
  Widget build(BuildContext context) => Center(
    key: const Key('empty-conversation'),
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 54,
              height: 54,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: PiColors.of(context).green.withValues(alpha: .1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.forum_outlined,
                color: PiColors.of(context).green,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              'Continue with Pi',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Voice and typed messages share this persistent orchestrator session.',
              textAlign: TextAlign.center,
              style: TextStyle(color: PiColors.of(context).muted),
            ),
          ],
        ),
      ),
    ),
  );
}

class _MessageRow extends StatelessWidget {
  const _MessageRow({
    required this.entry,
    required this.diagramExpanded,
    required this.onToggleDiagram,
    required this.onListen,
  });

  final TranscriptEntry entry;
  final bool diagramExpanded;
  final VoidCallback onToggleDiagram;
  final Future<void> Function(String) onListen;

  @override
  Widget build(BuildContext context) {
    if (entry.role == 'tool') return _ToolActivityRow(entry: entry);

    final isUser = entry.role == 'user';
    final visual = entry.role == 'assistant' && entry.status != 'running'
        ? VisualResponse.fromValue(entry.text)
        : null;
    final body = entry.role == 'assistant' && entry.status == 'running'
        ? entry.text.trim().isEmpty
              ? 'Pi is responding…'
              : entry.text
        : visual?.spoken ?? entry.text;
    return Align(
      key: Key('message-${entry.id}'),
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 760),
        margin: const EdgeInsets.only(bottom: 18),
        padding: EdgeInsets.all(isUser ? 14 : 16),
        decoration: BoxDecoration(
          color: isUser
              ? PiColors.of(context).blue.withValues(alpha: .13)
              : PiColors.of(context).surface,
          border: Border.all(
            color: isUser
                ? PiColors.of(context).blue.withValues(alpha: .32)
                : PiColors.of(context).border,
          ),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(15),
            topRight: const Radius.circular(15),
            bottomLeft: Radius.circular(isUser ? 15 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 15),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _MessageMeta(entry: entry),
            const SizedBox(height: 8),
            SelectableText(
              key: Key(
                entry.status == 'running'
                    ? 'streaming-message-${entry.id}'
                    : 'message-body-${entry.id}',
              ),
              body,
              style: entry.role == 'tool'
                  ? TextStyle(
                      fontFamily: 'monospace',
                      color: PiColors.of(context).muted,
                    )
                  : TextStyle(
                      color: entry.status == 'running'
                          ? PiColors.of(context).green
                          : PiColors.of(context).text,
                      height: 1.5,
                    ),
            ),
            if (visual != null) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    key: Key('diagram-${entry.id}'),
                    onPressed: onToggleDiagram,
                    icon: const Icon(Icons.account_tree_outlined, size: 15),
                    label: Text(
                      diagramExpanded ? 'Hide diagram' : 'Show diagram',
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => onListen(visual.spoken),
                    icon: const Icon(Icons.volume_up_outlined, size: 15),
                    label: const Text('Listen again'),
                  ),
                ],
              ),
              if (diagramExpanded)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: McpAppView(
                    key: Key('mcp-app-${entry.id}'),
                    presentation: visual.presentation,
                    resourceUri: visual.resourceUri,
                    height: 340,
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ToolActivityRow extends StatelessWidget {
  const _ToolActivityRow({required this.entry});

  final TranscriptEntry entry;

  @override
  Widget build(BuildContext context) {
    final failed = entry.status == 'failed';
    final running = entry.status == 'running';
    final color = failed
        ? PiColors.of(context).danger
        : running
        ? PiColors.of(context).orange
        : PiColors.of(context).green;
    final status = failed
        ? 'Failed'
        : running
        ? 'Running'
        : 'Completed';
    return Semantics(
      label: 'Tool activity: ${entry.text}, $status',
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          key: Key('tool-activity-${entry.id}'),
          constraints: const BoxConstraints(maxWidth: 760),
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: .045),
            border: Border.all(color: color.withValues(alpha: .3)),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (running)
                SizedBox(
                  width: 13,
                  height: 13,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.8,
                    color: color,
                  ),
                )
              else
                Icon(
                  failed ? Icons.error_outline_rounded : Icons.terminal_rounded,
                  size: 14,
                  color: color,
                ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  entry.text,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: color,
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Text(status, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageMeta extends StatelessWidget {
  const _MessageMeta({required this.entry});
  final TranscriptEntry entry;

  @override
  Widget build(BuildContext context) {
    final date = DateTime.fromMillisecondsSinceEpoch(entry.timestamp).toLocal();
    final clock =
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          entry.role == 'assistant' ? 'Pi' : entry.role,
          style: TextStyle(
            color: PiColors.of(context).green,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(width: 8),
        Text(clock, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.contextUsage,
    required this.sending,
    required this.stopping,
    required this.compactBusy,
    required this.onSend,
    required this.onStop,
    required this.onCompact,
  });

  final TextEditingController controller;
  final ContextUsage? contextUsage;
  final bool sending;
  final bool stopping;
  final bool compactBusy;
  final VoidCallback onSend;
  final VoidCallback onStop;
  final VoidCallback onCompact;

  @override
  Widget build(BuildContext context) {
    final usage = contextUsage;
    final tokens = usage?.tokens;
    final window = usage?.contextWindow;
    final usageLabel = tokens == null || window == null
        ? 'Context unavailable'
        : '${formatTokens(tokens)} / ${formatTokens(window)}';
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      decoration: BoxDecoration(
        color: PiColors.of(context).background,
        border: Border(top: BorderSide(color: PiColors.of(context).border)),
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 860),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      key: const Key('workspace-context-size'),
                      usageLabel,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton.icon(
                    key: const Key('compact-session'),
                    onPressed: usage?.canCompact == true && !compactBusy
                        ? onCompact
                        : null,
                    icon: compactBusy
                        ? const SizedBox(
                            width: 13,
                            height: 13,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.compress_rounded, size: 16),
                    label: const Text('Compact'),
                  ),
                ],
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      key: const Key('message-pi'),
                      controller: controller,
                      enabled: !sending,
                      minLines: 1,
                      maxLines: 5,
                      maxLength: 8000,
                      buildCounter: (
                        _, {
                        required currentLength,
                        required isFocused,
                        maxLength,
                      }) => null,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => onSend(),
                      decoration: const InputDecoration(
                        hintText: 'Message Pi…',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  IconButton.filled(
                    key: Key(sending ? 'stop-response' : 'send-message'),
                    onPressed: sending
                        ? stopping
                              ? null
                              : onStop
                        : onSend,
                    icon: stopping
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : sending
                        ? const Icon(Icons.stop_rounded)
                        : const Icon(Icons.arrow_upward_rounded),
                    tooltip: sending ? 'Stop response' : 'Send message',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TaskBoard extends StatelessWidget {
  const _TaskBoard({
    required this.api,
    required this.tasks,
    required this.busyTask,
    required this.listeningTaskId,
    required this.latestTaskProgress,
    required this.expanded,
    required this.onToggleDiagram,
    required this.onAction,
    required this.onListen,
    required this.onToggleNarration,
    required this.onCreate,
  });

  final VoiceApi api;
  final List<AgentTask> tasks;
  final String? busyTask;
  final String? listeningTaskId;
  final String? latestTaskProgress;
  final Set<String> expanded;
  final ValueChanged<String> onToggleDiagram;
  final Future<void> Function(AgentTask task, String action) onAction;
  final Future<void> Function(AgentTask task) onListen;
  final ValueChanged<AgentTask> onToggleNarration;
  final VoidCallback? onCreate;

  @override
  Widget build(BuildContext context) => CustomScrollView(
    key: const Key('task-board'),
    slivers: [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 12),
        sliver: SliverToBoxAdapter(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Durable work',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Review work proposed by Pi and follow execution to its output.',
                      style: TextStyle(color: PiColors.of(context).muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              FilledButton.icon(
                key: const Key('new-task-board'),
                onPressed: onCreate,
                icon: const Icon(Icons.add_rounded, size: 17),
                label: const Text('New task'),
              ),
            ],
          ),
        ),
      ),
      if (tasks.isEmpty)
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(
            child: Text(
              'No durable tasks yet.',
              style: TextStyle(color: PiColors.of(context).muted),
            ),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 32),
          sliver: SliverList.separated(
            itemCount: tasks.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (_, index) {
              final task = tasks[index];
              return Semantics(
                identifier: 'task-${task.id}',
                child: _TaskCard(
                  api: api,
                  task: task,
                  busy: busyTask == task.id,
                  listening: listeningTaskId == task.id,
                  latestProgress: listeningTaskId == task.id
                      ? latestTaskProgress
                      : null,
                  diagramExpanded: expanded.contains('task:${task.id}'),
                  onToggleDiagram: () => onToggleDiagram('task:${task.id}'),
                  onAction: (action) => onAction(task, action),
                  onListen: () => onListen(task),
                  onToggleNarration: () => onToggleNarration(task),
                ),
              );
            },
          ),
        ),
    ],
  );
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.api,
    required this.task,
    required this.busy,
    required this.listening,
    required this.latestProgress,
    required this.diagramExpanded,
    required this.onToggleDiagram,
    required this.onAction,
    required this.onListen,
    required this.onToggleNarration,
  });

  final VoiceApi api;
  final AgentTask task;
  final bool busy;
  final bool listening;
  final String? latestProgress;
  final bool diagramExpanded;
  final ValueChanged<String> onAction;
  final VoidCallback onToggleDiagram;
  final VoidCallback onListen;
  final VoidCallback onToggleNarration;

  String get _downloadArtifactName =>
      task.workspace == 'scratch' ? 'workspace' : 'patch';

  String get _downloadFilename =>
      _downloadArtifactName == 'workspace' ? 'workspace.zip' : 'changes.patch';

  @override
  Widget build(BuildContext context) => Material(
    key: Key('task-${task.id}'),
    color: PiColors.of(context).surface,
    clipBehavior: Clip.antiAlias,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(14),
      side: BorderSide(color: PiColors.of(context).border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 15, 16, 13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: _StateDot(state: task.state),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          task.sessionName ?? task.instruction,
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        if (task.sessionName != null) ...[
                          const SizedBox(height: 3),
                          Text(
                            task.instruction,
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                        const SizedBox(height: 5),
                        Text(
                          '${_stateLabel(task)} · ${_relativeTime(task.createdAt)}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  _StatusChip(
                    key: Key('task-status-${task.id}'),
                    state: task.state,
                  ),
                ],
              ),
              if (task.sessionArtist != null ||
                  task.sessionSpotifyUrl != null ||
                  task.isActive ||
                  task.response != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (task.sessionArtist case final artist?)
                      Text(
                        artist,
                        key: Key('task-session-artist-${task.id}'),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if (task.sessionSpotifyUrl case final spotifyUrl?)
                      OutlinedButton.icon(
                        key: Key('task-spotify-${task.id}'),
                        onPressed: () =>
                            ClientActions.openExternalUrl(spotifyUrl),
                        icon: const Icon(Icons.open_in_new_rounded, size: 15),
                        label: const Text('Listen on Spotify'),
                      ),
                    if (task.isActive || task.response != null)
                      OutlinedButton.icon(
                        key: Key('task-narration-${task.id}'),
                        onPressed: onToggleNarration,
                        icon: Icon(
                          listening
                              ? Icons.stop_rounded
                              : Icons.volume_up_outlined,
                          size: 16,
                        ),
                        label: Text(
                          listening ? 'Stop listening' : 'Listen to agent',
                        ),
                      ),
                  ],
                ),
              ],
              if (listening && latestProgress != null) ...[
                const SizedBox(height: 6),
                Text(
                  latestProgress!,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (task.response != null) ...[
                const SizedBox(height: 15),
                const Divider(),
                const SizedBox(height: 11),
                SelectableText(task.response!.spoken),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: onToggleDiagram,
                      icon: const Icon(Icons.account_tree_outlined, size: 15),
                      label: Text(
                        diagramExpanded ? 'Hide diagram' : 'Show diagram',
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: onListen,
                      icon: const Icon(Icons.volume_up_outlined, size: 15),
                      label: const Text('Listen again'),
                    ),
                  ],
                ),
                if (diagramExpanded)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: McpAppView(
                      key: Key('mcp-app-task-${task.id}'),
                      presentation: task.response!.presentation,
                      resourceUri: task.response!.resourceUri,
                      height: 360,
                    ),
                  ),
              ],
            ],
          ),
        ),
        ExpansionTile(
          dense: true,
          title: const Text(
            'Integrity & output',
            style: TextStyle(fontSize: 12),
          ),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(
              task.workspace == 'scratch'
                  ? 'Workspace: Scratch VM (no repository)'
                  : 'Workspace: ${task.workspace}',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
            const SizedBox(height: 7),
            SelectableText(
              'Plan SHA-256: ${task.planHash}',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            ),
            if (task.artifacts.contains(_downloadArtifactName)) ...[
              const SizedBox(height: 7),
              const Text('Task artifact · Tailscale HTTPS'),
              TextButton.icon(
                key: Key('task-artifact-${task.id}-$_downloadArtifactName'),
                onPressed: () => ClientActions.openTaskArtifactUrl(
                  api
                      .taskArtifactUrl(task.id, _downloadArtifactName)
                      .toString(),
                ),
                icon: const Icon(Icons.download_outlined, size: 15),
                label: Text('Download $_downloadFilename'),
              ),
              SelectableText(
                api.taskArtifactUrl(task.id, _downloadArtifactName).toString(),
                style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              ),
            ],
            if (task.failure != null) ...[
              const SizedBox(height: 7),
              SelectableText(
                const JsonEncoder.withIndent('  ').convert(task.failure),
              ),
            ],
          ],
        ),
        if (task.isActive)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (task.status == 'pending')
                  FilledButton.icon(
                    key: Key('approve-${task.id}'),
                    onPressed: busy ? null : () => onAction('approve'),
                    icon: const Icon(Icons.check_rounded, size: 16),
                    label: const Text('Approve'),
                  ),
                OutlinedButton.icon(
                  key: Key('cancel-${task.id}'),
                  onPressed: busy ? null : () => onAction('cancel'),
                  icon: const Icon(Icons.close_rounded, size: 16),
                  label: const Text('Cancel'),
                ),
              ],
            ),
          ),
      ],
    ),
  );
}

class _StateDot extends StatelessWidget {
  const _StateDot({required this.state});
  final String state;

  @override
  Widget build(BuildContext context) => Container(
    width: 8,
    height: 8,
    decoration: BoxDecoration(
      color: _stateColor(context, state),
      shape: BoxShape.circle,
    ),
  );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.state, super.key});
  final String state;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: _stateColor(context, state).withValues(alpha: .1),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      state.toUpperCase(),
      style: TextStyle(
        color: _stateColor(context, state),
        fontSize: 9,
        fontWeight: FontWeight.w700,
        letterSpacing: .6,
      ),
    ),
  );
}

class _NewTaskDialog extends StatefulWidget {
  const _NewTaskDialog();

  @override
  State<_NewTaskDialog> createState() => _NewTaskDialogState();
}

class _NewTaskDialogState extends State<_NewTaskDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Create durable task'),
    content: SizedBox(
      width: 520,
      child: TextField(
        key: const Key('new-task-instruction'),
        controller: _controller,
        autofocus: true,
        minLines: 4,
        maxLines: 8,
        maxLength: 8000,
        decoration: const InputDecoration(
          hintText: 'Describe the outcome Pi should deliver…',
        ),
      ),
    ),
    actions: [
      TextButton(
        style: TextButton.styleFrom(minimumSize: const Size(44, 52)),
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        key: const Key('submit-new-task'),
        style: FilledButton.styleFrom(minimumSize: const Size(44, 52)),
        onPressed: () {
          final value = _controller.text.trim();
          if (value.isNotEmpty) Navigator.pop(context, value);
        },
        child: const Text('Create task'),
      ),
    ],
  );
}

class _NoticeBanner extends StatelessWidget {
  const _NoticeBanner({
    required this.text,
    required this.onDismiss,
    this.danger = false,
    super.key,
  });

  final String text;
  final bool danger;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    color: (danger ? PiColors.of(context).danger : PiColors.of(context).blue)
        .withValues(alpha: .11),
    padding: const EdgeInsets.only(left: 16, right: 6),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: danger
                  ? PiColors.of(context).danger
                  : PiColors.of(context).blue,
            ),
          ),
        ),
        IconButton(
          onPressed: onDismiss,
          icon: const Icon(Icons.close_rounded, size: 17),
          tooltip: 'Dismiss',
        ),
      ],
    ),
  );
}

Color _stateColor(BuildContext context, String state) => switch (state) {
  'completed' || 'succeeded' => PiColors.of(context).green,
  'running' => PiColors.of(context).blue,
  'pending' || 'approved' || 'sleeping' => PiColors.of(context).orange,
  'cancelled' || 'failed' => PiColors.of(context).danger,
  _ => PiColors.of(context).muted,
};

String _stateLabel(AgentTask task) => switch (task.state) {
  'completed' || 'succeeded' => 'Completed',
  'running' => 'Running',
  'pending' => 'Waiting for approval',
  'approved' => 'Approved',
  'sleeping' => 'Waiting',
  'cancelled' => 'Cancelled',
  'failed' => 'Failed',
  _ => task.state,
};

String _relativeTime(DateTime value) {
  final elapsed = DateTime.now().difference(value.toLocal());
  if (elapsed.isNegative || elapsed.inMinutes < 1) return 'now';
  if (elapsed.inHours < 1) return '${elapsed.inMinutes}m ago';
  if (elapsed.inDays < 1) return '${elapsed.inHours}h ago';
  return '${elapsed.inDays}d ago';
}

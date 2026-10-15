import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../browser_bridge.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/mermaid_view.dart';

enum VoicePhase { ready, starting, listening, muted, thinking, speaking }

class VoiceView extends StatefulWidget {
  const VoiceView({required this.api, super.key});
  final VoiceApi api;

  @override
  State<VoiceView> createState() => _VoiceViewState();
}

class _VoiceViewState extends State<VoiceView> {
  static const initialDiagram = '''flowchart TD
  voice["Voice"] --> pi["Pi"]
  pi --> waiting["Waiting for response"]''';

  VoicePhase _phase = VoicePhase.ready;
  ContextUsage? _context;
  String _diagram = initialDiagram;
  String? _error;
  bool _compactBusy = false;
  Timer? _eventTimer;
  Timer? _contextTimer;

  @override
  void initState() {
    super.initState();
    _eventTimer = Timer.periodic(const Duration(milliseconds: 120), (_) => _readEvents());
    _refreshContext();
    _contextTimer = Timer.periodic(const Duration(seconds: 10), (_) => _refreshContext());
  }

  @override
  void dispose() {
    _eventTimer?.cancel();
    _contextTimer?.cancel();
    super.dispose();
  }

  void _readEvents() {
    final raw = BrowserBridge.consumeEvents();
    if (raw == '[]' || !mounted) return;
    try {
      final values = jsonDecode(raw) as List;
      setState(() {
        for (final value in values) {
          final event = asMap(value);
          switch (event['type']) {
            case 'connected' || 'ready':
              _phase = VoicePhase.listening;
            case 'disconnected':
              _phase = VoicePhase.ready;
            case 'thinking':
              if (event['active'] == true) {
                _phase = VoicePhase.thinking;
              } else if (_phase == VoicePhase.thinking) {
                _phase = VoicePhase.listening;
              }
            case 'speaking':
              if (event['active'] == true) {
                _phase = VoicePhase.speaking;
              } else if (_phase == VoicePhase.speaking) {
                _phase = VoicePhase.listening;
              }
            case 'mermaid':
              final next = event['diagram'];
              if (next is String && next.isNotEmpty && next.length <= 24000) _diagram = next;
          }
        }
      });
    } on Object {
      // Ignore malformed bridge events; the next poll remains healthy.
    }
  }

  Future<void> _refreshContext() async {
    try {
      final value = await widget.api.context();
      if (mounted) setState(() => _context = value);
    } on Object {
      // Context is supplementary; keep voice controls usable.
    }
  }

  Future<void> _start() async {
    setState(() { _phase = VoicePhase.starting; _error = null; });
    try {
      await BrowserBridge.startVoice();
      if (mounted) setState(() => _phase = VoicePhase.listening);
    } on Object {
      if (mounted) setState(() { _phase = VoicePhase.ready; _error = 'Could not start the conversation.'; });
    }
  }

  void _toggleMute() {
    final muted = _phase != VoicePhase.muted;
    BrowserBridge.setMuted(muted);
    setState(() => _phase = muted ? VoicePhase.muted : VoicePhase.listening);
  }

  Future<void> _stop() async {
    try {
      await BrowserBridge.stopVoice();
      if (mounted) setState(() { _phase = VoicePhase.ready; _error = null; });
    } on Object {
      if (mounted) setState(() => _error = 'Could not stop the conversation.');
    }
  }

  Future<void> _compact() async {
    setState(() { _compactBusy = true; _error = null; });
    try {
      final value = await widget.api.compact();
      if (mounted) setState(() => _context = value);
    } on Object {
      if (mounted) setState(() => _error = 'Could not compact context.');
    } finally {
      if (mounted) setState(() => _compactBusy = false);
    }
  }

  String get _stateLabel => switch (_phase) {
    VoicePhase.ready => 'Ready',
    VoicePhase.starting => 'Starting…',
    VoicePhase.listening => 'Listening',
    VoicePhase.muted => 'Muted',
    VoicePhase.thinking => 'Thinking…',
    VoicePhase.speaking => 'Speaking',
  };

  bool get _connected => !const {VoicePhase.ready, VoicePhase.starting}.contains(_phase);

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final horizontal = width >= 900 ? 32.0 : width >= 600 ? 24.0 : 16.0;
    final diagramHeight = width >= 900 ? 460.0 : width >= 600 ? 390.0 : 330.0;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: ListView(
              padding: EdgeInsets.fromLTRB(horizontal, 18, horizontal, 28),
              children: [
                _Header(stateLabel: _stateLabel),
                if (_error != null) Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_error!, key: const Key('voice-error'), style: const TextStyle(color: PiColors.danger)),
                ),
                const SizedBox(height: 20),
                SurfaceCard(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Eyebrow('Live response'),
                      const SizedBox(height: 6),
                      Text('Conversation map', style: Theme.of(context).textTheme.headlineMedium),
                      const SizedBox(height: 10),
                      MermaidView(key: const Key('live-mermaid'), diagram: _diagram, height: diagramHeight),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _ConversationDock(
                  phase: _phase,
                  contextUsage: _context,
                  compactBusy: _compactBusy,
                  onCompact: _context?.canCompact == true ? _compact : null,
                  onStart: _phase == VoicePhase.starting ? null : _start,
                  onMute: _toggleMute,
                  onStop: _stop,
                  connected: _connected,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.stateLabel});
  final String stateLabel;

  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.spaceBetween,
    crossAxisAlignment: WrapCrossAlignment.center,
    runSpacing: 12,
    children: [
      const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(backgroundColor: PiColors.green, foregroundColor: PiColors.background, child: Text('P')),
          SizedBox(width: 12),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Pi Voice', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
            Text('Private coding workspace', style: TextStyle(color: PiColors.muted, fontSize: 12)),
          ]),
        ],
      ),
      Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Container(
          key: const Key('voice-state'),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(color: PiColors.surfaceRaised, borderRadius: BorderRadius.circular(20), border: Border.all(color: PiColors.border)),
          child: Text(stateLabel),
        ),
        OutlinedButton(onPressed: () => BrowserBridge.openView('audio-diagnostics'), child: const Text('Replays')),
        OutlinedButton(onPressed: () => BrowserBridge.openView('transcript'), child: const Text('Chat')),
      ]),
    ],
  );
}

class _ConversationDock extends StatelessWidget {
  const _ConversationDock({
    required this.phase, required this.contextUsage, required this.compactBusy,
    required this.onCompact, required this.onStart, required this.onMute,
    required this.onStop, required this.connected,
  });
  final VoicePhase phase;
  final ContextUsage? contextUsage;
  final bool compactBusy;
  final VoidCallback? onCompact;
  final VoidCallback? onStart;
  final VoidCallback onMute;
  final VoidCallback onStop;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final contextText = contextUsage?.tokens == null
        ? '—'
        : '${contextUsage!.estimated ? '~' : ''}${formatTokens(contextUsage!.tokens!)}'
          '${contextUsage!.contextWindow == null ? '' : ' / ${formatTokens(contextUsage!.contextWindow!)}'}';
    final activity = switch (phase) {
      VoicePhase.speaking => ('Pi is responding', 'Response audio is playing'),
      VoicePhase.thinking => ('Pi is thinking', 'Working on your request'),
      VoicePhase.muted => ('Microphone muted', 'Pi remains connected and can still respond'),
      VoicePhase.listening => ('Conversation active', 'Mute the microphone when privacy is needed'),
      _ => ('Start when you are ready', 'Audio stays on this machine'),
    };
    final status = Row(children: [
      AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        width: 48, height: 48,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: phase == VoicePhase.thinking ? PiColors.purple : PiColors.green,
          boxShadow: phase == VoicePhase.speaking ? [BoxShadow(color: PiColors.green.withValues(alpha: .4), blurRadius: 24)] : null,
        ),
        alignment: Alignment.center,
        child: const Text('P', style: TextStyle(color: PiColors.background, fontWeight: FontWeight.w800, fontSize: 20)),
      ),
      const SizedBox(width: 14),
      Flexible(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(activity.$1, style: Theme.of(context).textTheme.titleMedium),
        Text(activity.$2, style: Theme.of(context).textTheme.bodySmall),
      ])),
    ]);
    final contextControl = Row(mainAxisSize: MainAxisSize.min, children: [
      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('CONTEXT', style: TextStyle(color: PiColors.muted, fontSize: 10, letterSpacing: 1.4)),
        Text(contextText, key: const Key('context-size'), style: const TextStyle(fontWeight: FontWeight.w700)),
        if (contextUsage?.percent != null) Text('${contextUsage!.percent!.round()}% used', style: Theme.of(context).textTheme.bodySmall),
      ]),
      const SizedBox(width: 12),
      OutlinedButton(
        key: const Key('compact-button'),
        onPressed: compactBusy ? null : onCompact,
        child: Text(compactBusy ? 'Compacting…' : 'Compact'),
      ),
    ]);
    return SurfaceCard(
      child: Column(children: [
        if (width >= 720)
          Row(children: [Expanded(child: status), contextControl])
        else ...[status, const SizedBox(height: 18), Align(alignment: Alignment.centerLeft, child: contextControl)],
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: !connected
              ? ElevatedButton(
                  key: const Key('start-conversation'),
                  onPressed: onStart,
                  child: Text(phase == VoicePhase.starting ? 'Starting…' : 'Start conversation'),
                )
              : Row(children: [
                  Expanded(child: OutlinedButton(
                    key: const Key('mute-conversation'), onPressed: onMute,
                    child: Text(phase == VoicePhase.muted ? 'Unmute' : 'Mute'),
                  )),
                  const SizedBox(width: 10),
                  Expanded(child: ElevatedButton(
                    key: const Key('end-conversation'),
                    onPressed: onStop,
                    style: ElevatedButton.styleFrom(backgroundColor: PiColors.danger),
                    child: const Text('End conversation'),
                  )),
                ]),
        ),
      ]),
    );
  }
}

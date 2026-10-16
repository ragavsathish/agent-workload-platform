import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../platform/client_actions.dart';
import '../platform/voice_session.dart';
import '../theme.dart';
import '../ux_telemetry.dart';
import '../widgets/mermaid_view.dart';

enum VoicePhase { ready, starting, listening, muted, thinking, speaking }

class VoiceView extends StatefulWidget {
  const VoiceView({required this.api, this.session, super.key});
  final VoiceApi api;
  final VoiceSession? session;

  @override
  State<VoiceView> createState() => _VoiceViewState();
}

class _VoiceViewState extends State<VoiceView> {
  VoicePhase _phase = VoicePhase.ready;
  bool _isMuted = false;
  ContextUsage? _context;
  String _diagram = '';
  bool _hasLiveDiagram = false;
  String? _error;
  bool _compactBusy = false;
  late final VoiceSession _session;
  late final bool _ownsSession;
  StreamSubscription<VoiceEvent>? _eventSubscription;
  Timer? _contextTimer;

  @override
  void initState() {
    super.initState();
    _ownsSession = widget.session == null;
    _session = widget.session ?? createVoiceSession();
    _eventSubscription = _session.events.listen(_handleEvent);
    _refreshContext();
    _contextTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => _refreshContext(),
    );
  }

  @override
  void dispose() {
    _eventSubscription?.cancel();
    if (_ownsSession) _session.dispose();
    _contextTimer?.cancel();
    super.dispose();
  }

  void _handleEvent(VoiceEvent event) {
    if (!mounted) return;
    setState(() {
      switch (event.type) {
        case VoiceEventType.connected || VoiceEventType.ready:
          _phase = VoicePhase.listening;
        case VoiceEventType.disconnected:
          _phase = VoicePhase.ready;
          _isMuted = false;
        case VoiceEventType.muted:
          _isMuted = event.active == true;
        case VoiceEventType.thinking:
          if (event.active == true) {
            _phase = VoicePhase.thinking;
          } else if (_phase == VoicePhase.thinking) {
            _phase = VoicePhase.listening;
          }
        case VoiceEventType.speaking:
          if (event.active == true) {
            _phase = VoicePhase.speaking;
          } else if (_phase == VoicePhase.speaking) {
            _phase = VoicePhase.listening;
          }
        case VoiceEventType.mermaid:
          final next = event.diagram;
          if (next != null && next.isNotEmpty && next.length <= 24000) {
            _diagram = next;
            _hasLiveDiagram = true;
          }
        case VoiceEventType.audioError:
          _error = event.message ?? 'Audio output failed.';
        case VoiceEventType.audioOutput || VoiceEventType.transport:
          break;
      }
    });
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
    final started = Stopwatch()..start();
    setState(() {
      _phase = VoicePhase.starting;
      _isMuted = false;
      _error = null;
    });
    try {
      await _session.connect();
      UxTelemetry.instance.record('control.start', duration: started.elapsed);
      if (mounted) setState(() => _phase = VoicePhase.listening);
    } on Object {
      UxTelemetry.instance.record(
        'control.start',
        duration: started.elapsed,
        outcome: 'error',
      );
      if (mounted) {
        setState(() {
          _phase = VoicePhase.ready;
          _error = 'Could not start the conversation.';
        });
      }
    }
  }

  void _toggleMute() {
    final started = Stopwatch()..start();
    final muted = !_isMuted;
    setState(() => _isMuted = muted);
    _session.setMuted(muted);
    UxTelemetry.instance.record('control.mute', duration: started.elapsed);
  }

  Future<void> _stop() async {
    final started = Stopwatch()..start();
    try {
      await _session.disconnect();
      UxTelemetry.instance.record('control.stop', duration: started.elapsed);
      if (mounted) {
        setState(() {
          _phase = VoicePhase.ready;
          _isMuted = false;
          _error = null;
        });
      }
    } on Object {
      UxTelemetry.instance.record(
        'control.stop',
        duration: started.elapsed,
        outcome: 'error',
      );
      if (mounted) setState(() => _error = 'Could not stop the conversation.');
    }
  }

  Future<void> _compact() async {
    setState(() {
      _compactBusy = true;
      _error = null;
    });
    try {
      final value = await widget.api.compact();
      if (mounted) setState(() => _context = value);
    } on Object {
      if (mounted) setState(() => _error = 'Could not compact context.');
    } finally {
      if (mounted) setState(() => _compactBusy = false);
    }
  }

  VoicePhase get _displayPhase => switch (_phase) {
    VoicePhase.thinking => VoicePhase.thinking,
    VoicePhase.speaking => VoicePhase.speaking,
    _ when _isMuted => VoicePhase.muted,
    _ => _phase,
  };

  String get _stateLabel => switch (_displayPhase) {
    VoicePhase.ready => 'Ready',
    VoicePhase.starting => 'Starting…',
    VoicePhase.listening => 'Listening',
    VoicePhase.muted => 'Muted',
    VoicePhase.thinking => 'Thinking…',
    VoicePhase.speaking => 'Speaking',
  };

  bool get _connected =>
      !const {VoicePhase.ready, VoicePhase.starting}.contains(_phase);

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final width = size.width;
    final mobile = width < 600;
    final horizontal = width >= 900
        ? 40.0
        : width >= 600
        ? 24.0
        : 12.0;
    final diagramHeight = mobile
        ? (size.height - 300).clamp(320.0, 520.0)
        : width >= 900
        ? (size.height - 400).clamp(430.0, 720.0)
        : (size.height - 360).clamp(380.0, 760.0);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                horizontal,
                mobile ? 10 : 18,
                horizontal,
                mobile ? 18 : 28,
              ),
              children: [
                _Header(stateLabel: _stateLabel),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      _error!,
                      key: const Key('voice-error'),
                      style: const TextStyle(color: PiColors.danger),
                    ),
                  ),
                SizedBox(height: mobile ? 8 : 12),
                Container(
                  padding: EdgeInsets.fromLTRB(
                    mobile ? 14 : 24,
                    mobile ? 12 : 20,
                    mobile ? 14 : 24,
                    mobile ? 8 : 12,
                  ),
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xFF252E35)),
                    borderRadius: BorderRadius.circular(18),
                    gradient: const LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0xFF11171C), Color(0xFF0A0E12)],
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (mobile)
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                'Conversation map',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Text(
                              'PINCH · DRAG',
                              style: TextStyle(
                                color: PiColors.muted,
                                fontFamily: 'monospace',
                                fontSize: 9,
                                letterSpacing: 1,
                              ),
                            ),
                          ],
                        )
                      else ...[
                        const Eyebrow('Live response'),
                        const SizedBox(height: 6),
                        const Text(
                          'Conversation map',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      SizedBox(height: mobile ? 6 : 10),
                      if (_hasLiveDiagram)
                        MermaidView(
                          key: const Key('live-mermaid'),
                          diagram: _diagram,
                          height: diagramHeight,
                        )
                      else
                        _ConversationMapPlaceholder(height: diagramHeight),
                    ],
                  ),
                ),
                SizedBox(height: mobile ? 10 : 16),
                _ConversationDock(
                  phase: _displayPhase,
                  muted: _isMuted,
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

class _ConversationMapPlaceholder extends StatelessWidget {
  const _ConversationMapPlaceholder({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    excludeSemantics: true,
    label: 'Conversation map. Voice flows to Pi, waiting for response.',
    child: SizedBox(
      key: const Key('conversation-map-placeholder'),
      height: height,
      width: double.infinity,
      child: const CustomPaint(painter: _ConversationMapPainter()),
    ),
  );
}

class _ConversationMapPainter extends CustomPainter {
  const _ConversationMapPainter();

  @override
  void paint(Canvas canvas, Size size) {
    const labels = ['Voice', 'Pi', 'Waiting for\nresponse'];
    final boxWidth = (size.width * .42).clamp(150.0, 260.0);
    final boxHeight = (size.height * .18).clamp(48.0, 72.0);
    final totalHeight = boxHeight * 3 + 56;
    final startY = ((size.height - totalHeight) / 2).clamp(14.0, 80.0);
    final left = (size.width - boxWidth) / 2;
    final border = Paint()
      ..color = const Color(0xFF66716D)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final fill = Paint()..color = const Color(0xFF171D1C);
    final connector = Paint()
      ..color = const Color(0xFF82958C)
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    for (var index = 0; index < labels.length; index += 1) {
      final top = startY + index * (boxHeight + 28);
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(left, top, boxWidth, boxHeight),
        const Radius.circular(2),
      );
      canvas.drawRRect(rect, fill);
      canvas.drawRRect(rect, border);
      final text = TextPainter(
        text: TextSpan(
          text: labels[index],
          style: const TextStyle(
            color: Color(0xFFDDE6E1),
            fontSize: 14,
            height: 1.25,
          ),
        ),
        textAlign: TextAlign.center,
        textDirection: TextDirection.ltr,
      )..layout(maxWidth: boxWidth - 20);
      text.paint(
        canvas,
        Offset(
          left + (boxWidth - text.width) / 2,
          top + (boxHeight - text.height) / 2,
        ),
      );

      if (index == labels.length - 1) continue;
      final centerX = size.width / 2;
      final lineStart = top + boxHeight;
      final lineEnd = lineStart + 21;
      canvas.drawLine(
        Offset(centerX, lineStart),
        Offset(centerX, lineEnd),
        connector,
      );
      final arrow = Path()
        ..moveTo(centerX - 5, lineEnd - 5)
        ..lineTo(centerX, lineEnd + 3)
        ..lineTo(centerX + 5, lineEnd - 5);
      canvas.drawPath(arrow, connector);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _Header extends StatelessWidget {
  const _Header({required this.stateLabel});
  final String stateLabel;

  @override
  Widget build(BuildContext context) {
    const desktopBrand = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _BrandMark(),
        SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Pi Voice',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
            SizedBox(height: 2),
            Text(
              'Private coding workspace',
              style: TextStyle(color: Color(0xFF697681), fontSize: 10.5),
            ),
          ],
        ),
      ],
    );
    final desktopActions = Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _VoiceState(stateLabel),
        OutlinedButton.icon(
          onPressed: () => ClientActions.openView('audio-diagnostics'),
          icon: const Icon(Icons.graphic_eq_rounded, size: 15),
          label: const Text('Replays'),
        ),
        OutlinedButton.icon(
          onPressed: () => ClientActions.openView('transcript'),
          icon: const Icon(Icons.chat_bubble_outline_rounded, size: 15),
          label: const Text('Chat'),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) => constraints.maxWidth < 600
          ? Row(
              children: [
                const _BrandMark(),
                const SizedBox(width: 9),
                const Text(
                  'Pi Voice',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                ),
                const Spacer(),
                _VoiceState(stateLabel, compact: true),
                const SizedBox(width: 2),
                _HeaderIconButton(
                  tooltip: 'Replays',
                  icon: Icons.graphic_eq_rounded,
                  onPressed: () => ClientActions.openView('audio-diagnostics'),
                ),
                _HeaderIconButton(
                  tooltip: 'Chat',
                  icon: Icons.chat_bubble_outline_rounded,
                  onPressed: () => ClientActions.openView('transcript'),
                ),
              ],
            )
          : Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                desktopBrand,
                const SizedBox(width: 16),
                Flexible(child: desktopActions),
              ],
            ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });
  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    onPressed: onPressed,
    icon: Icon(icon, size: 18),
    visualDensity: VisualDensity.compact,
    style: IconButton.styleFrom(
      foregroundColor: PiColors.text,
      side: const BorderSide(color: PiColors.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
  );
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) => Container(
    width: 32,
    height: 32,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: const Color(0xFF123426),
      border: Border.all(color: const Color(0xFF32654F)),
      borderRadius: BorderRadius.circular(9),
    ),
    child: const Text(
      'P',
      style: TextStyle(
        color: Color(0xFF7CF1BA),
        fontFamily: 'monospace',
        fontSize: 13,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _VoiceState extends StatelessWidget {
  const _VoiceState(this.label, {this.compact = false});
  final String label;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = switch (label) {
      'Listening' || 'Speaking' => PiColors.green,
      'Thinking…' => PiColors.blue,
      'Muted' || 'Starting…' => PiColors.orange,
      _ => const Color(0xFF65717B),
    };
    return Semantics(
      key: const Key('voice-state'),
      label: label,
      excludeSemantics: true,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: compact ? 3 : 5, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color,
                boxShadow: [
                  BoxShadow(
                    color: color.withValues(alpha: .45),
                    blurRadius: 10,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 7),
            Text(
              compact && label == 'Starting…'
                  ? 'STARTING'
                  : label.toUpperCase(),
              style: const TextStyle(
                color: Color(0xFF89949F),
                fontSize: 10,
                fontWeight: FontWeight.w600,
                letterSpacing: .9,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConversationDock extends StatelessWidget {
  const _ConversationDock({
    required this.phase,
    required this.muted,
    required this.contextUsage,
    required this.compactBusy,
    required this.onCompact,
    required this.onStart,
    required this.onMute,
    required this.onStop,
    required this.connected,
  });
  final VoicePhase phase;
  final bool muted;
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
    final mobile = width < 600;
    final contextText = contextUsage?.tokens == null
        ? '—'
        : '${contextUsage!.estimated ? '~' : ''}${formatTokens(contextUsage!.tokens!)}'
              '${contextUsage!.contextWindow == null ? '' : ' / ${formatTokens(contextUsage!.contextWindow!)}'}';
    final activity = switch (phase) {
      VoicePhase.speaking => ('Pi is responding', 'Response audio is playing'),
      VoicePhase.thinking => ('Pi is thinking', 'Working on your request'),
      VoicePhase.muted => (
        'Microphone muted',
        'Pi remains connected and can still respond',
      ),
      VoicePhase.listening => (
        'Conversation active',
        'Mute the microphone when privacy is needed',
      ),
      _ => ('Start when you are ready', 'Audio stays on this machine'),
    };
    final status = Row(
      children: [
        _PiActivity(phase: phase, compact: mobile),
        SizedBox(width: mobile ? 8 : 11),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(activity.$1, style: Theme.of(context).textTheme.titleMedium),
              if (!mobile)
                Text(activity.$2, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ],
    );
    final contextControl = Container(
      padding: EdgeInsets.only(left: mobile ? 0 : 16),
      decoration: BoxDecoration(
        border: mobile
            ? null
            : const Border(left: BorderSide(color: PiColors.border)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!mobile)
                const Text(
                  'CONTEXT',
                  style: TextStyle(
                    color: PiColors.muted,
                    fontSize: 10,
                    letterSpacing: 1.4,
                  ),
                ),
              Text(
                contextText,
                key: const Key('context-size'),
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              if (!mobile && contextUsage?.percent != null)
                Text(
                  '${contextUsage!.percent!.round()}% used',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
          const SizedBox(width: 12),
          OutlinedButton(
            key: const Key('compact-button'),
            onPressed: compactBusy ? null : onCompact,
            child: Text(compactBusy ? 'Compacting…' : 'Compact'),
          ),
        ],
      ),
    );
    final controls = !connected
        ? ElevatedButton.icon(
            key: const Key('start-conversation'),
            onPressed: onStart,
            icon: const Icon(Icons.mic_rounded, size: 17),
            label: Text(
              phase == VoicePhase.starting ? 'Starting…' : 'Start conversation',
            ),
          )
        : Row(
            mainAxisSize: mobile ? MainAxisSize.max : MainAxisSize.min,
            children: [
              if (mobile)
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('mute-conversation'),
                    onPressed: onMute,
                    icon: Icon(
                      muted ? Icons.mic_rounded : Icons.mic_off_outlined,
                      size: 16,
                    ),
                    label: Text(muted ? 'Unmute' : 'Mute'),
                  ),
                )
              else
                OutlinedButton.icon(
                  key: const Key('mute-conversation'),
                  onPressed: onMute,
                  icon: Icon(
                    muted ? Icons.mic_rounded : Icons.mic_off_outlined,
                    size: 16,
                  ),
                  label: Text(muted ? 'Unmute' : 'Mute'),
                ),
              const SizedBox(width: 8),
              if (mobile)
                Expanded(
                  child: ElevatedButton.icon(
                    key: const Key('end-conversation'),
                    onPressed: onStop,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF351B1F),
                      foregroundColor: const Color(0xFFFFB4B8),
                    ),
                    icon: const Icon(Icons.stop_rounded, size: 17),
                    label: const Text('End'),
                  ),
                )
              else
                ElevatedButton.icon(
                  key: const Key('end-conversation'),
                  onPressed: onStop,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF351B1F),
                    foregroundColor: const Color(0xFFFFB4B8),
                  ),
                  icon: const Icon(Icons.stop_rounded, size: 17),
                  label: const Text('End conversation'),
                ),
            ],
          );
    return SurfaceCard(
      padding: EdgeInsets.fromLTRB(
        mobile ? 12 : 16,
        mobile ? 10 : 12,
        mobile ? 12 : 14,
        mobile ? 10 : 12,
      ),
      child: width >= 900
          ? Row(
              children: [
                Expanded(child: status),
                contextControl,
                const SizedBox(width: 12),
                controls,
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: status),
                    contextControl,
                  ],
                ),
                const SizedBox(height: 10),
                Align(alignment: Alignment.centerRight, child: controls),
              ],
            ),
    );
  }
}

class _PiActivity extends StatefulWidget {
  const _PiActivity({required this.phase, this.compact = false});
  final VoicePhase phase;
  final bool compact;

  @override
  State<_PiActivity> createState() => _PiActivityState();
}

class _PiActivityState extends State<_PiActivity>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  bool get _active =>
      widget.phase == VoicePhase.speaking ||
      widget.phase == VoicePhase.thinking ||
      widget.phase == VoicePhase.starting;

  @override
  void initState() {
    super.initState();
    if (_active) _controller.repeat();
  }

  @override
  void didUpdateWidget(covariant _PiActivity oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_active && !_controller.isAnimating) {
      _controller.repeat();
    } else if (!_active && _controller.isAnimating) {
      _controller
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (_, child) => CustomPaint(
      painter: _ActivityPainter(widget.phase, _controller.value),
      child: child,
    ),
    child: Container(
      width: widget.compact ? 36 : 48,
      height: widget.compact ? 36 : 48,
      alignment: Alignment.center,
      child: Container(
        width: 21,
        height: 21,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: const Color(0xFF10251D),
          border: Border.all(color: const Color(0x6B72EFB6)),
        ),
        child: const Text(
          'P',
          style: TextStyle(
            color: Color(0xFFA4F7CF),
            fontFamily: 'monospace',
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    ),
  );
}

class _ActivityPainter extends CustomPainter {
  const _ActivityPainter(this.phase, this.progress);
  final VoicePhase phase;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final active =
        phase == VoicePhase.speaking ||
        phase == VoicePhase.thinking ||
        phase == VoicePhase.starting;
    for (var index = 0; index < 12; index++) {
      final angle = index * 3.141592653589793 * 2 / 12;
      final pulse = active
          ? .5 + .5 * ((progress * 12 - index).abs() % 6) / 6
          : .22;
      final inner = 16.0;
      final outer = inner + 3 + pulse * 4;
      final paint = Paint()
        ..color = Color.lerp(
          const Color(0xFF426558),
          const Color(0xFF72EFB6),
          pulse,
        )!
        ..strokeWidth = 1.8
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(
        center + Offset.fromDirection(angle, inner),
        center + Offset.fromDirection(angle, outer),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _ActivityPainter oldDelegate) =>
      oldDelegate.phase != phase || oldDelegate.progress != progress;
}

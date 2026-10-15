import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../models.dart';
import '../theme.dart';
import '../widgets/audio_waveform.dart';
import '../widgets/metric_chart.dart';

class AudioDiagnosticsView extends StatefulWidget {
  const AudioDiagnosticsView({required this.api, super.key});
  final VoiceApi api;

  @override
  State<AudioDiagnosticsView> createState() => _AudioDiagnosticsViewState();
}

class _AudioDiagnosticsViewState extends State<AudioDiagnosticsView> {
  List<AudioSession> _sessions = const [];
  List<Map<String, double>> _waveform = const [];
  String? _selected;
  String? _error;
  bool _loading = true;
  bool _live = false;
  double? _latency;
  Timer? _sessionsTimer;
  Timer? _liveTimer;

  @override
  void initState() {
    super.initState();
    _refreshSessions();
    _refreshLive();
    _sessionsTimer = Timer.periodic(const Duration(seconds: 10), (_) => _refreshSessions());
    _liveTimer = Timer.periodic(const Duration(milliseconds: 250), (_) => _refreshLive());
  }

  @override
  void dispose() {
    _sessionsTimer?.cancel();
    _liveTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshSessions() async {
    try {
      final sessions = await widget.api.audioSessions();
      if (mounted) {
        setState(() { _sessions = sessions; _loading = false; _error = null; });
      }
    } on Object {
      if (mounted) setState(() { _loading = false; _error = 'Audio replays are unavailable.'; });
    }
  }

  Future<void> _refreshLive() async {
    try {
      final body = await widget.api.liveAudio();
      final waveform = (body['waveform'] as List? ?? const []).map((value) {
        final point = asMap(value);
        return {
          'min': (point['min'] as num?)?.toDouble() ?? 0,
          'max': (point['max'] as num?)?.toDouble() ?? 0,
        };
      }).toList(growable: false);
      final point = asMap(body['point']);
      if (mounted) {
        setState(() {
          _live = body['active'] == true;
          _waveform = waveform;
          _latency = (point['voxlockLatencyMs'] as num?)?.toDouble();
        });
      }
    } on Object {
      if (mounted) setState(() => _live = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final horizontal = MediaQuery.sizeOf(context).width >= 720 ? 28.0 : 16.0;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: ListView(
              padding: EdgeInsets.fromLTRB(horizontal, 22, horizontal, 30),
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  runSpacing: 12,
                  children: [
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Eyebrow('Input diagnostics'),
                      Text('Last five conversations', style: Theme.of(context).textTheme.headlineMedium),
                      const Text('Replay the same microphone input before and after each server-side filter.', style: TextStyle(color: PiColors.muted)),
                    ]),
                    OutlinedButton(onPressed: _refreshSessions, child: const Text('Refresh')),
                  ],
                ),
                const SizedBox(height: 18),
                _LiveCard(active: _live, waveform: _waveform, latency: _latency),
                if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: PiColors.danger))),
                if (_loading) const Padding(padding: EdgeInsets.all(36), child: Center(child: CircularProgressIndicator())),
                if (!_loading && _sessions.isEmpty && _error == null)
                  const Padding(padding: EdgeInsets.all(36), child: Center(child: Text('No completed conversations yet. End a voice conversation to save its replay.'))),
                ..._sessions.indexed.map((entry) => Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: _SessionCard(
                    index: entry.$1,
                    session: entry.$2,
                    selected: _selected == entry.$2.id,
                    onSelect: () => setState(() => _selected = entry.$2.id),
                    api: widget.api,
                  ),
                )),
                const SizedBox(height: 18),
                const Text('Stored locally in the private voice-service volume. Starting a sixth completed session removes the oldest.', textAlign: TextAlign.center, style: TextStyle(color: PiColors.muted, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LiveCard extends StatelessWidget {
  const _LiveCard({required this.active, required this.waveform, required this.latency});
  final bool active;
  final List<Map<String, double>> waveform;
  final double? latency;

  @override
  Widget build(BuildContext context) => SurfaceCard(
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Eyebrow('Live input'),
          Text(active ? 'Microphone envelope' : 'Waiting for a conversation', style: Theme.of(context).textTheme.titleLarge),
        ])),
        if (latency != null) Text('${latency!.toStringAsFixed(1)} ms VoxLock', style: const TextStyle(color: PiColors.green)),
      ]),
      const SizedBox(height: 12),
      SizedBox(height: 120, width: double.infinity, child: CustomPaint(painter: _WaveformPainter(waveform))),
    ]),
  );
}

class _WaveformPainter extends CustomPainter {
  _WaveformPainter(this.points);
  final List<Map<String, double>> points;
  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()..color = PiColors.border;
    canvas.drawLine(Offset(0, size.height / 2), Offset(size.width, size.height / 2), grid);
    if (points.isEmpty) return;
    final paint = Paint()..color = PiColors.green..strokeWidth = 1.5..style = PaintingStyle.stroke;
    final upper = Path();
    final lower = Path();
    for (var index = 0; index < points.length; index++) {
      final x = size.width * index / math.max(1, points.length - 1);
      final maxValue = points[index]['max'] ?? 0;
      final minValue = points[index]['min'] ?? 0;
      final yUpper = size.height * (.5 - maxValue.clamp(-1, 1) / 2);
      final yLower = size.height * (.5 - minValue.clamp(-1, 1) / 2);
      if (index == 0) { upper.moveTo(x, yUpper); lower.moveTo(x, yLower); } else { upper.lineTo(x, yUpper); lower.lineTo(x, yLower); }
    }
    canvas.drawPath(upper, paint);
    canvas.drawPath(lower, paint);
  }
  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) => oldDelegate.points != points;
}

class _SessionCard extends StatefulWidget {
  const _SessionCard({required this.index, required this.session, required this.selected, required this.onSelect, required this.api});
  final int index;
  final AudioSession session;
  final bool selected;
  final VoidCallback onSelect;
  final VoiceApi api;

  @override
  State<_SessionCard> createState() => _SessionCardState();
}

class _SessionCardState extends State<_SessionCard> {
  List<MetricPoint>? _points;
  String? _error;

  Future<void> _load() async {
    widget.onSelect();
    if (_points != null) return;
    try {
      final points = await widget.api.metrics(widget.session.id);
      if (mounted) setState(() => _points = points);
    } on Object {
      if (mounted) setState(() => _error = 'Diagnostic metrics are unavailable for this session.');
    }
  }

  double? _average(List<double> values) => values.isEmpty ? null : values.reduce((a, b) => a + b) / values.length;

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return SurfaceCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Session ${widget.index + 1}', style: Theme.of(context).textTheme.titleMedium),
            Text(session.completedAt.toLocal().toString(), style: Theme.of(context).textTheme.bodySmall),
          ])),
          Text('${session.durationSeconds.round()}s', style: const TextStyle(color: PiColors.green)),
        ]),
        const SizedBox(height: 12),
        if (!widget.selected)
          OutlinedButton(onPressed: _load, child: const Text('Load waveform comparison'))
        else ...[
          LayoutBuilder(builder: (context, constraints) {
            final wide = constraints.maxWidth >= 760;
            final children = session.variants.map((variant) => _variant(variant)).toList();
            return wide
                ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: children.map((child) => Expanded(child: Padding(padding: const EdgeInsets.only(right: 10), child: child))).toList())
                : Column(children: children.map((child) => Padding(padding: const EdgeInsets.only(bottom: 12), child: child)).toList());
          }),
          if (_error != null) Text(_error!, style: const TextStyle(color: PiColors.danger)),
          if (_points == null && _error == null) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
          if (_points != null) ..._charts(_points!),
        ],
        if (session.droppedChunks > 0 || session.truncated)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text('${session.droppedChunks > 0 ? '${session.droppedChunks} chunks were not recorded. ' : ''}${session.truncated ? 'Recording reached the configured duration limit.' : ''}', style: const TextStyle(color: PiColors.orange)),
          ),
      ]),
    );
  }

  Widget _variant(String variant) {
    const labels = {'raw': 'Raw microphone', 'voxlock': 'VoxLock', 'rnnoise': 'RNNoise'};
    const colors = {'raw': '#73808a', 'voxlock': '#56e39f', 'rnnoise': '#72b7ef'};
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Text(labels[variant] ?? variant, style: const TextStyle(fontWeight: FontWeight.w700))),
        if (variant == widget.session.selectedFilter) const Text('Live path', style: TextStyle(color: PiColors.green, fontSize: 11)),
      ]),
      const SizedBox(height: 8),
      AudioWaveform(
        url: '/api/audio-diagnostics/${Uri.encodeComponent(widget.session.id)}/${Uri.encodeComponent(variant)}.wav',
        color: colors[variant] ?? '#73808a',
        showSpectrogram: variant == 'raw' || variant == 'voxlock',
      ),
    ]);
  }

  List<Widget> _charts(List<MetricPoint> points) {
    List<double?> values(String key) => points.map((point) => point.number(key)).toList();
    final masks = points.map((point) => point.numbers('maskMagnitude')).where((v) => v.length == 32).toList();
    final maskProfile = List<double>.generate(32, (index) => masks.isEmpty ? 0 : masks.map((v) => v[index]).reduce((a, b) => a + b) / masks.length);
    final widgets = <Widget>[
      MetricChart(title: 'Input and output energy · dBFS', series: [
        ChartSeries(label: 'Raw', color: PiColors.muted, values: values('rawDbfs')),
        ChartSeries(label: 'VoxLock', color: PiColors.green, values: values('voxlockDbfs')),
        ChartSeries(label: 'RNNoise', color: PiColors.blue, values: values('rnnoiseDbfs')),
      ]),
      MetricChart(title: 'Suppression · dB', series: [
        ChartSeries(label: 'VoxLock', color: PiColors.green, values: values('voxlockSuppressionDb')),
        ChartSeries(label: 'RNNoise', color: PiColors.blue, values: values('rnnoiseSuppressionDb')),
      ]),
      MetricChart(title: 'Filter inference latency · ms', series: [
        ChartSeries(label: 'VoxLock', color: PiColors.green, values: values('voxlockLatencyMs')),
        ChartSeries(label: 'RNNoise', color: PiColors.blue, values: values('rnnoiseLatencyMs')),
      ]),
      MetricChart(title: 'LSTM-state RMS activity', series: [
        ChartSeries(label: 'Hidden state', color: PiColors.purple, values: points.map((p) => _average(p.numbers('lstmHiddenRms'))).toList()),
        ChartSeries(label: 'Cell state', color: PiColors.orange, values: points.map((p) => _average(p.numbers('lstmCellRms'))).toList()),
      ]),
      MetricChart(title: 'Mean predicted complex-mask magnitude · model band', bars: true, series: [
        ChartSeries(label: 'Mask magnitude', color: PiColors.green, values: maskProfile),
      ]),
    ];
    return widgets.map((widget) => Padding(padding: const EdgeInsets.only(top: 12), child: widget)).toList();
  }
}

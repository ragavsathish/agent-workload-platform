import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import 'platform/ux_telemetry_sink.dart' as sink;

class UxTelemetry {
  UxTelemetry._();

  static final instance = UxTelemetry._();

  static const _allowedNames = {
    'app.first_frame',
    'frame.build.average',
    'frame.build.maximum',
    'frame.build.jank',
    'frame.raster.average',
    'frame.raster.maximum',
    'frame.raster.jank',
    'control.start',
    'control.mute',
    'control.stop',
    'mcp_app.render',
  };

  final _startedAt = Stopwatch();
  static const _sampleLimit = 500;

  final List<Map<String, Object>> _samples = [];
  Timer? _snapshotTimer;
  int _frameCount = 0;
  int _buildJank = 0;
  int _rasterJank = 0;
  double _buildTotalMs = 0;
  double _rasterTotalMs = 0;
  double _buildMaxMs = 0;
  double _rasterMaxMs = 0;

  String get _platform => kIsWeb
      ? 'web'
      : switch (defaultTargetPlatform) {
          TargetPlatform.iOS => 'ios',
          TargetPlatform.android => 'android',
          _ => 'other',
        };

  void start() {
    if (_startedAt.isRunning) return;
    _startedAt.start();
    SchedulerBinding.instance.addTimingsCallback(_collectFrames);
    _snapshotTimer = Timer.periodic(
      const Duration(seconds: 10),
      (_) => snapshotFrames(),
    );
  }

  void firstFrame() => record('app.first_frame', duration: _startedAt.elapsed);

  void record(
    String name, {
    Duration? duration,
    String outcome = 'ok',
    int count = 1,
  }) {
    if (!_allowedNames.contains(name) || !{'ok', 'error'}.contains(outcome)) {
      return;
    }
    final event = <String, Object>{
      'name': name,
      'platform': _platform,
      'outcome': outcome,
      'count': count.clamp(1, 10000),
      'recordedAtEpochMs': DateTime.now().millisecondsSinceEpoch,
      if (duration != null)
        'durationMs':
            duration.inMicroseconds / Duration.microsecondsPerMillisecond,
    };
    _samples.add(event);
    if (_samples.length > _sampleLimit) {
      _samples.removeRange(0, _samples.length - _sampleLimit);
    }
    sink.publishUxMetric(event);
  }

  void _collectFrames(List<FrameTiming> timings) {
    for (final timing in timings) {
      final buildMs = timing.buildDuration.inMicroseconds / 1000;
      final rasterMs = timing.rasterDuration.inMicroseconds / 1000;
      _frameCount += 1;
      _buildTotalMs += buildMs;
      _rasterTotalMs += rasterMs;
      _buildMaxMs = buildMs > _buildMaxMs ? buildMs : _buildMaxMs;
      _rasterMaxMs = rasterMs > _rasterMaxMs ? rasterMs : _rasterMaxMs;
      if (buildMs > 16.7) _buildJank += 1;
      if (rasterMs > 16.7) _rasterJank += 1;
    }
  }

  void snapshotFrames() {
    if (_frameCount == 0) return;
    record(
      'frame.build.average',
      duration: Duration(
        microseconds: (_buildTotalMs * 1000 / _frameCount).round(),
      ),
      count: _frameCount,
    );
    record(
      'frame.build.maximum',
      duration: Duration(microseconds: (_buildMaxMs * 1000).round()),
    );
    if (_buildJank > 0) {
      record('frame.build.jank', count: _buildJank.clamp(1, 10000));
    }
    record(
      'frame.raster.average',
      duration: Duration(
        microseconds: (_rasterTotalMs * 1000 / _frameCount).round(),
      ),
      count: _frameCount,
    );
    record(
      'frame.raster.maximum',
      duration: Duration(microseconds: (_rasterMaxMs * 1000).round()),
    );
    if (_rasterJank > 0) {
      record('frame.raster.jank', count: _rasterJank.clamp(1, 10000));
    }
    _frameCount = 0;
    _buildJank = 0;
    _rasterJank = 0;
    _buildTotalMs = 0;
    _rasterTotalMs = 0;
    _buildMaxMs = 0;
    _rasterMaxMs = 0;
  }

  List<Map<String, Object>> snapshot() => _samples
      .map((sample) => Map<String, Object>.unmodifiable(sample))
      .toList(growable: false);

  void clear() => _samples.clear();

  void dispose() {
    SchedulerBinding.instance.removeTimingsCallback(_collectFrames);
    _snapshotTimer?.cancel();
  }
}

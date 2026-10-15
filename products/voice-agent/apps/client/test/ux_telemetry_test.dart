import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/ux_telemetry.dart';

void main() {
  test('keeps bounded structured UX measurements locally', () {
    final telemetry = UxTelemetry.instance..clear();

    telemetry.record(
      'control.start',
      duration: const Duration(milliseconds: 42),
    );
    telemetry.record('transcript.secret', duration: const Duration(seconds: 1));

    final samples = telemetry.snapshot();
    expect(samples, hasLength(1));
    expect(samples.single, containsPair('name', 'control.start'));
    expect(samples.single, containsPair('outcome', 'ok'));
    expect(samples.single, containsPair('count', 1));
    expect(samples.single, containsPair('durationMs', 42.0));
  });

  test('retains only the newest 500 samples', () {
    final telemetry = UxTelemetry.instance..clear();

    for (var index = 0; index < 510; index += 1) {
      telemetry.record('control.mute', count: index + 1);
    }

    final samples = telemetry.snapshot();
    expect(samples, hasLength(500));
    expect(samples.first['count'], 11);
    expect(samples.last['count'], 510);
  });
}

@JS()
library;

import 'dart:convert';
import 'dart:js_interop';

@JS('__piUxTelemetry.recordJson')
external void _recordJson(JSString event);

void publishUxMetric(Map<String, Object> event) {
  _recordJson(jsonEncode(event).toJS);
}

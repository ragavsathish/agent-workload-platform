import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/platform/embedded_navigation_policy.dart';

void main() {
  final trustedOrigin = Uri.parse('https://voice.example.test/');

  test('allows paths and query parameters on the trusted origin', () {
    expect(
      isAllowedVoiceWorkspaceNavigation(
        Uri.parse('https://voice.example.test/?view=transcript'),
        trustedOrigin,
      ),
      isTrue,
    );
  });

  test('rejects lookalike hosts and non-HTTPS scheme changes', () {
    expect(
      isAllowedVoiceWorkspaceNavigation(
        Uri.parse('https://voice.example.test.attacker.invalid/'),
        trustedOrigin,
      ),
      isFalse,
    );
    expect(
      isAllowedVoiceWorkspaceNavigation(
        Uri.parse('http://voice.example.test/'),
        trustedOrigin,
      ),
      isFalse,
    );
  });

  test('allows the platform bootstrap blank document', () {
    expect(
      isAllowedVoiceWorkspaceNavigation(
        Uri.parse('about:blank'),
        trustedOrigin,
      ),
      isTrue,
    );
  });

  test('rejects an insecure configured origin', () {
    expect(
      isAllowedVoiceWorkspaceNavigation(
        Uri.parse('http://voice.example.test/'),
        Uri.parse('http://voice.example.test/'),
      ),
      isFalse,
    );
  });
}

# Component contract for validating a Docker archive before VM handoff.
Feature: Archive validation for an execution image

  Rule: Only a complete requested image may cross the handoff

    @c8-archive-001 @current
    Scenario: Complete requested image is accepted
      Given a regular Docker archive has a manifest naming the requested tag
      And its config and every referenced layer are present
      When the archive is validated
      Then it is accepted for image handoff

    @c8-archive-002 @current
    Scenario: Missing Docker manifest is refused
      Given an archive has no regular manifest.json member
      When the archive is validated
      Then it is refused as missing a Docker manifest

    @c8-archive-003 @current
    Scenario: Invalid or oversized manifest is refused
      Given manifest.json is malformed or exceeds four mebibytes
      When the archive is validated
      Then it is refused as an invalid manifest

    @c8-archive-004 @current
    Scenario: Requested tag must be present
      Given the manifest names images but none has the requested tag
      When the archive is validated
      Then it is refused as the wrong image tag

    @c8-archive-005 @current
    Scenario: Config reference is required
      Given the matching image has no config reference
      When the archive is validated
      Then it is refused as missing a config reference

    @c8-archive-006 @current
    Scenario: Referenced blobs must be present
      Given the matching image references a config or layer member absent from the archive
      When the archive is validated
      Then it is refused with the missing member named

    @c8-archive-007 @current
    Scenario: Unreadable or malformed archive is refused
      Given the archive cannot be opened or read as a tar stream
      When the archive is validated
      Then it is refused without accepting an incomplete image

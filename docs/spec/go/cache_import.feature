Feature: Verified import of a Compose cache handoff
  Shared image archives are promoted only after their provenance is checked.

  @behavior-cache_import-001
  Scenario: A valid handoff is promoted
    Given a handoff contains a cache index, Compose override, cache ID, and image archives
    And every indexed archive has the expected name, tag, checksum, and complete Docker manifest
    When the importer promotes the handoff to the shared store
    Then the shared store contains the verified archives
    And the preload directory contains the index, override, and cache ID

  @behavior-cache_import-002
  Scenario: Existing valid shared archives are reused
    Given the shared store already contains an archive matching the handoff checksum and tag
    When the importer promotes that handoff
    Then it reuses the existing shared archive

  @behavior-cache_import-003
  Scenario: Invalid handoff data is refused
    Given the handoff has a missing metadata file, malformed index, invalid archive name, bad checksum, or incomplete image archive
    When the importer checks the handoff
    Then it reports an error instead of treating the handoff as imported

  @behavior-cache_import-004
  Scenario: Promotion replaces stale local preload archives
    Given a valid handoff has been promoted
    When the importer updates preload metadata
    Then stale local Compose archives are removed
    And promoted image archives remain in the shared store

Feature: Host storage measurements
  The collector emits one JSON record per available measurement.

  @behavior-storage_collector-001
  Scenario: Known host directories are measured
    Given the host has Gondolin image, image handoff, and builder asset directories
    When the collector samples their sizes
    Then it emits directory records with byte counts for available paths
    And an unavailable path does not suppress other directory records

  @behavior-storage_collector-002
  Scenario: Repository artifacts are optionally measured
    Given a repository artifacts directory is configured
    When the collector samples storage
    Then it emits a directory record for repository artifacts when available

  @behavior-storage_collector-003
  Scenario: Docker storage is measured by kind
    Given Docker storage usage is available
    When the collector samples Docker
    Then it emits total and reclaimable byte counts for images, containers, volumes, and build cache

  @behavior-storage_collector-004
  Scenario: Docker failure preserves directory measurements
    Given one or more host directory measurements are available
    When Docker storage usage cannot be collected
    Then the collector still emits the available directory records
    And it reports the Docker sampling error on the diagnostic stream

  @behavior-storage_collector-005
  Scenario: A measurement is machine readable
    Given a storage measurement has a metric, optional area or kind, and byte count
    When the collector publishes it
    Then it is emitted as one JSON object on one output line

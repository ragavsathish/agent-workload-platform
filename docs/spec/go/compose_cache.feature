Feature: Host preparation of Compose image cache
  Registry and verified host-built images become a portable VM handoff.

  @behavior-compose_cache-001
  Scenario: Registry images are prepared for a Compose project
    Given a rendered Compose configuration with image services
    When the host processes a Compose cache job
    Then it pulls or inspects the referenced images through Docker Engine
    And it exports usable archives for the requested architecture

  @behavior-compose_cache-002
  Scenario: Build services need verified image identifiers
    Given a Compose service has a build definition and an image reference
    When the cache request supplies its verified host-built image identifier
    Then the handoff includes that image
    And a build service without such an identifier is omitted

  @behavior-compose_cache-003
  Scenario: A completed cache has a portable handoff
    Given the host has prepared one or more service images
    When the cache job succeeds
    Then the handoff contains an index, Compose override, cache ID, and image archives
    And status reports the handoff location and service and image counts

  @behavior-compose_cache-004
  Scenario: Invalid Compose input is refused
    Given a Compose request has no image service, too many services, or an invalid built image mapping
    When the request is submitted
    Then the service rejects it before using Docker Engine

  @behavior-compose_cache-005
  Scenario: A missing image blob cannot become a cache artifact
    Given Docker Engine exports an image archive with a missing referenced blob
    When the host validates that archive
    Then cache preparation fails instead of publishing that archive

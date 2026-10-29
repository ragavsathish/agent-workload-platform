Feature: Portable Docker image archives

  @behavior-image_archive-001
  Scenario: An archive has a complete target image
    Given a Docker image archive contains its manifest, requested tag, config, and referenced layers
    When the archive is validated
    Then it is accepted for VM handoff

  @behavior-image_archive-002
  Scenario: An incomplete archive is refused
    Given a Docker image archive lacks a manifest, requested tag, config, or referenced layer
    When the archive is validated
    Then it is rejected as incomplete

  @behavior-image_archive-003
  Scenario: A remote image is exported for the requested architecture
    Given a source image and supported target architecture
    When the host exports the image for VM handoff
    Then the resulting archive uses that architecture and requested tag
    And a failed export leaves no partial destination archive

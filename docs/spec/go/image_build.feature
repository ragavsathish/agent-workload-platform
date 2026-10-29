Feature: Verified host image builds
  A build must correspond to reviewed source inputs and a verified context archive.

  @behavior-image_build-001
  Scenario: A workflow derives the expected artifact version
    Given a source revision, image configuration, and its declared Git inputs
    When the workflow plans a host image build
    Then it derives the artifact version from those inputs and the build contract
    And it rejects a requested version that differs

  @behavior-image_build-002
  Scenario: Unsupported build inputs are refused
    Given a build uses a named local context, a Dockerfile outside its context, or a fixed private registry base reference
    When the workflow plans a host image build
    Then it refuses to submit the build

  @behavior-image_build-003
  Scenario: A build context is accepted only after verification
    Given an image build job awaits a context and declares its byte count and SHA-256
    When the caller uploads a matching tar archive, optionally transported with gzip
    Then the service queues the build
    And the job records the verified context size and digest

  @behavior-image_build-004
  Scenario: A mismatched context is refused
    Given an image build job awaits a context
    When an upload has the wrong size, digest, or an unsupported encoding
    Then the service rejects the upload
    And temporary invalid context data is removed

  @behavior-image_build-005
  Scenario: Reuploading a context is refused
    Given an image build job no longer awaits a context
    When a caller uploads another context for that job
    Then the service reports a conflict

  @behavior-image_build-006
  Scenario: A verified context produces a handoff
    Given an image build job has a verified context
    When Docker Engine builds and exports the requested image
    Then the job succeeds with a result identifying the image and handoff
    And the context staging file is removed after processing

  @behavior-image_build-007
  Scenario: Build failure is visible
    Given Docker Engine cannot complete a build or export
    When the host processes the job
    Then the job fails with an error available from status

  @behavior-image_build-008
  Scenario: A workflow follows build progress
    Given an image build has been submitted with an authenticated context upload
    When the workflow polls the job status
    Then it prints each new progress segment once
    And it writes the completed result for its caller

  @behavior-image_build-009
  Scenario: A temporary status error is retried
    Given a submitted image build is still running
    When a status request fails temporarily
    Then the workflow retries status retrieval within its bounded wait

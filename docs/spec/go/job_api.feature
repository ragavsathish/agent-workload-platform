Feature: Authenticated host jobs for image work
  The host accepts bounded work requests while keeping Docker access on the host.

  @behavior-job_api-001
  Scenario: A caller checks service health
    Given the host job service is running
    When a caller requests its health endpoint without a token
    Then the service reports that it is healthy

  @behavior-job_api-002
  Scenario: A caller accesses protected jobs
    Given the host job service has an authorization token
    When a caller requests a job endpoint without a matching bearer token
    Then the request is rejected as unauthorized

  @behavior-job_api-003
  Scenario: A valid job is accepted
    Given a valid Compose cache or image build request has a run ID, revision, and architecture
    When an authorized caller submits the request
    Then the service returns an accepted job with an identifier and status location
    And a Compose cache job is queued while an image build awaits its context

  @behavior-job_api-004
  Scenario: Repeating a run ID is idempotent
    Given an authorized caller has submitted a valid job
    When the caller submits the same request with the same run ID
    Then the service returns the existing job
    And no second job is created

  @behavior-job_api-005
  Scenario: Reusing a run ID for different work is refused
    Given a run ID is associated with a job
    When an authorized caller submits different work with that run ID
    Then the service reports a conflict

  @behavior-job_api-006
  Scenario: Invalid or excessive work is refused
    Given a job request has an invalid revision, architecture, work type, image reference, or manifest
    When an authorized caller submits the request
    Then the service rejects it before starting work

  @behavior-job_api-007
  Scenario: An authorized caller follows job progress
    Given a job has been accepted
    When the caller requests its status
    Then the response identifies its lifecycle state
    And completed work includes its result while failed work includes an error

  @behavior-job_api-008
  Scenario: The host talks to its local Docker Engine
    Given Docker Engine is available through the host Unix socket
    When a host job needs an Engine operation
    Then it negotiates the Engine API version and sends the operation through that socket

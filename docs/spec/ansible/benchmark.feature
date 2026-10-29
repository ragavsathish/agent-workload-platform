Feature: Measure a selected local benchmark category

  Rule: A benchmark run records both success and failure

    @behavior-benchmark-001
    Scenario: Only supported benchmark categories are accepted
      Given a requested category other than native inference, concurrent Pi VM smoke,
        parallel Compose VM startup, VM Docker storage, or VM lifecycle
      When a benchmark run is requested
      Then the request is refused before measurement begins

    @behavior-benchmark-002
    Scenario Outline: The selected category produces a bounded result
      Given the <category> benchmark has its required inputs
      When that category runs
      Then one category result is selected for reporting
      And the result identifies its measurement and evidence locations

      Examples:
        | category                    |
        | native inference            |
        | concurrent Pi VM smoke      |
        | parallel Compose VM startup |
        | VM Docker storage           |
        | VM lifecycle                |

    @behavior-benchmark-003
    Scenario: A failed benchmark preserves its report
      Given a benchmark returned an unsuccessful result with a report directory
      When the run finishes
      Then the Markdown and JSON report locations are shown
      And the overall run fails after the available report is preserved

    @behavior-benchmark-004
    Scenario: Native inference records stage latency and resource use
      Given local language, speech-generation, and optional speech-recognition models
        can be warmed
      When native inference is measured for a positive number of iterations
      Then the result contains at least one measured stage
      And each measured stage reports latency, throughput, peak memory, and peak CPU

    @behavior-benchmark-005
    Scenario: Concurrent Pi VM smoke reports each VM and host headroom
      Given an image, a project checkout, and a valid VM count
      When independent Pi sessions run concurrently
      Then the result records passed and total VMs with per-VM durations
      And host memory, swap, disk, and runner evidence are retained

    @behavior-benchmark-006
    Scenario: Parallel project startup measures readiness
      Given an image, project checkout, and project startup command or Compose file
      When independent VMs start the project concurrently
      Then the result records how many VMs became ready and their readiness times
      And host resource headroom is reported
      And optional Patrol evidence is recorded when requested

    @behavior-benchmark-007
    Scenario: VM Docker storage records the selected driver
      Given a supported guest storage driver and a project startup input
      When the project starts inside the VM
      Then the result reports the observed driver, startup time, probe status,
        and guest disk measurements

    @behavior-benchmark-008
    Scenario: VM lifecycle requires a completed checkpoint run
      Given a smoke result whose checkpoints were retained
      When VM lifecycle is measured
      Then cold boot, checkpoint resume, and checkpoint storage are reported
      And an incomplete lifecycle result is unsuccessful

    @behavior-benchmark-009
    Scenario: Reports do not reveal guest environment values
      Given guest environment overrides contain private values
      When any benchmark report is written
      Then its parameters contain only the override names
      And its report files are owner-only

    @behavior-benchmark-010
    Scenario: A dry run states the planned benchmark without executing it
      Given a valid benchmark request in check mode
      When the request is evaluated
      Then the planned command is reported
      And no benchmark report directory is created

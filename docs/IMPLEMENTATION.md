# Implementation status and roadmap

## Target

The V1 target is conceptually:

```text
Fully tune my theater
```

The workflow should inspect the theater, measure a protected baseline, hand off optimization to A1 Evo Nexus, wait for the supported MultEQ transfer, re-measure Preset 1 and Preset 2 with matched evidence, derive metrics automatically, reject regressions, and recommend the winning preset.

The governing rule is unchanged:

```text
apply or select candidate -> re-measure -> validate evidence -> compare -> accept/reject
```

A predicted or calculated setting is never sufficient evidence of acoustic improvement.

## Architecture boundaries

Use REW for measurement, A1 Evo Nexus for XT32 optimization, EvoBurrow for receiver safety and guarded operations, Shield ADB for deterministic encoded Atmos playback, and MultEQ Editor for the supported `.ady` transfer path in V1.

Do not implement another FFT/DSP engine, Atmos encoder, Audyssey optimizer, Nexus clone, licensing bypass, or generic Denon protocol console.

## Evidence model

Measurement attempts are immutable:

```text
measurements/position-0/TFL/
  attempt-001-<rew-uuid>.json
  attempt-002-<rew-uuid>.json
  accepted.json
```

A failed attempt remains evidence. A retry gets a new attempt number. `accepted.json` deterministically resolves the currently accepted immutable record. Workflow state may change, raw acoustic evidence may not be silently overwritten.

## V1 status matrix

| Capability | Status | Notes |
| --- | --- | --- |
| REW Base64 float decoding | Implemented and CI-tested | Handles binary trace payloads |
| REW UUID measurement IDs | Implemented and CI-tested | UUIDs retained as evidence identity |
| Measure From File negotiation | Implemented and CI-tested | Uses advertised REW contract, automatic start requires REW Pro |
| Manual REW fallback | Implemented and CI-tested | Resumable checkpoint |
| Denon MPLAY/input parsing | Implemented and CI-tested | Live input verification before audio |
| Volume/mute/power safety | Implemented and CI-tested | Audible measurement fails closed |
| Distortion capture | Implemented and CI-tested | Used as headroom/THD proxy when available |
| Immutable retries | Implemented and CI-tested | Failed attempts preserved, accepted attempt resolvable |
| Topology normalization | Implemented and CI-tested | Read-only detection, explicit channels allowed when uncertain |
| Pre-Nexus measurement | Implemented, hardware-unverified | Preset 1 required before baseline audio |
| Nexus handoff | Implemented, hardware-unverified | Nexus remains optimizer |
| Optimized `.ady` validation | Implemented, hardware-unverified | Does not automate MultEQ transfer |
| Preset 1/2 verification runner | Implemented and CI-tested | Separate resumable datasets, wrong preset blocks audio |
| Matched-coverage gate | Implemented and CI-tested | Position/channel/type/topology/dataset definition must match |
| Automatic seven-metric extraction | Implemented and CI-tested | Raw provenance retained |
| Automatic finalization | Implemented and CI-tested | No manual numeric score entry required |
| Regression rollback recommendation | Implemented and CI-tested | Reject => Preset 1, win => Preset 2 |
| Final Markdown report | Implemented and CI-tested | Includes raw evidence and rejected-attempt history |
| First TFL hardware proof | Implemented, requires theater validation | No pass from HTTP success alone |
| Speaker distance/trim/crossover writes | Blocked by safe capability | No raw Denon fallback |
| Programmatic preset selection | Blocked by safe capability | Human checkpoint in V1 |
| MultEQ Editor upload | Intentionally manual V1 | V2 candidate for ADB/UIAutomator |
| Nexus UI automation | Intentionally manual V1 unless supported wrapper exists | Must respect licensing |

## Matched Preset verification

`theater_verification_start` creates two datasets from one definition. Both contain the same:

- positions
- channels
- topology declaration
- sweep manifest
- measurement type

Before every audible verification step the service inspects the receiver and verifies the required active Speaker Preset. The service does not silently change presets because the current EvoBurrow surface does not expose a proven safe preset-selection mutation.

Expected checkpoints are therefore:

```text
Select Speaker Preset 1, then resume.
Select Speaker Preset 2, then resume.
```

Finalization refuses comparison when dataset definitions or accepted acoustic coverage differ.

## Automatic metrics

The seven normalized components and weights are:

```text
bassIntegration        25%
crossoverIntegration   20%
timing                  15%
frequencyResponse       15%
channelConsistency      10%
seatConsistency         10%
headroom                 5%
```

Each derived component retains:

- score, 0-100
- raw statistic
- units
- evidence source
- relevant channels and positions
- assumptions/caveats
- confidence

Missing evidence stays missing. It is not estimated to force a complete score.

Headroom currently uses measured distortion/THD where REW exposes usable data. At one playback level this is explicitly a margin proxy. It is not labeled as maximum SPL, compression onset, or true maximum-output capability.

## Final acceptance gate

`theater_verification_finalize` performs, in order:

1. dataset-state matching
2. accepted-attempt resolution
3. acoustic matched-coverage validation
4. metric derivation
5. weighted scoring
6. baseline/candidate comparison
7. major-regression detection
8. report generation
9. preset recommendation

Preset 2 is accepted only when all required metrics exist, coverage matches, evidence confidence is high, aggregate improvement meets the configured minimum, and no component crosses the major-regression threshold.

A failure returns:

```text
status = regression_rejected
recommendedPreset = 1
```

A passing candidate returns:

```text
status = complete
recommendedPreset = 2
```

The receiver is not automatically mutated to follow the recommendation when safe preset switching is unavailable.

## Topology policy

The workflow no longer blindly assumes a fixed 7.1.4 layout. It attempts to normalize active channels from Denon/EvoBurrow read-only inspection. If that evidence is not confident enough, explicit channels must be supplied and the topology is marked user-provided.

The following remain read-only/protected:

- amp assignment
- speaker existence
- terminal mapping
- subwoofer count
- impedance
- Zone 2
- HDMI configuration
- pre-out configuration

V1 will not alter those to make a measurement workflow fit its assumptions.

## Hardware proof policy

The first real proof is deliberately one channel, one position, TFL. Before audio the proof requires evidence for:

- REW reachability
- usable microphone input check
- required REW API/Measure From File contract
- Shield ADB reachability
- exact encoded TFL file existence
- readable local REW stimulus
- Denon reachability
- correct input
- bounded volume
- unmuted state
- known and correct Speaker Preset

During playback it additionally requires the Denon to report Atmos. After playback REW must contain a valid new measurement that passes the quality gate. Only then is the proof marked passed.

## V1 manual boundaries

Human actions that remain acceptable in V1:

1. move the microphone
2. start REW manually if REW Pro automation is unavailable
3. complete Nexus if no supported automation hook exists
4. upload `.ady` through MultEQ Editor
5. select Speaker Preset 1 or 2 when safe programmatic switching is unavailable

These are explicit workflow checkpoints, not hidden claims of automation.

## V2 blockers

A truly unattended version still needs:

- a supported safe EvoBurrow preset-selection operation
- baseline-bound, allowlisted speaker distance/trim/crossover mutations if closed-loop search is desired
- supported Nexus automation without bypassing licensing restrictions
- MultEQ Editor automation, most likely Android ADB/UIAutomator with post-action verification
- hardware-proven topology extraction against the actual X3700H/EvoBurrow payloads
- hardware-proven REW 5.40 and Shield behavior across a full theater run

## Merge gate for PR #1

Software-only V1 can be complete while PR #1 remains unmerged. The PR should stay draft until the real theater proves at least:

1. TFL, one position, Preset 1 hardware proof passes
2. encoded TFL is physically routed to TFL
3. Denon reports Atmos during playback
4. REW records and stores a valid immutable TFL attempt
5. manual REW resume works if needed on the installed REW license
6. a short Preset 1/Preset 2 matched verification can complete on real hardware

No test should be skipped or weakened merely to make CI green.

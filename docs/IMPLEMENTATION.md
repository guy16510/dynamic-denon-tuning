# Implementation status and roadmap

## Target

The V1 target is conceptually:

```text
Fully tune my theater
```

The workflow inspects the theater, measures a protected baseline, hands optimization to A1 Evo Nexus, waits for supported MultEQ transfer, re-measures Speaker Preset 1 and Speaker Preset 2 with matched evidence, derives metrics automatically, rejects regressions, and records the recommended preset in the original autotune session.

The governing rule is:

```text
apply or select candidate -> re-measure -> validate evidence -> compare -> accept/reject
```

A predicted setting, API success response, or manually supplied score is never sufficient evidence of acoustic improvement.

## Architecture boundaries

Use REW for measurement, A1 Evo Nexus for XT32 optimization, EvoBurrow for receiver safety and guarded operations, Shield ADB for deterministic encoded Atmos playback, and MultEQ Editor for the supported `.ady` transfer path in V1.

Do not implement another FFT/DSP engine, Atmos encoder, Audyssey optimizer, Nexus clone, licensing bypass, or generic Denon protocol console.

## Evidence model

Measurement attempts are append-only:

```text
measurements/position-0/TFL/
  attempt-001-<rew-uuid>.json
  attempt-002-<rew-uuid>.json
  accepted.json
```

A failed attempt remains evidence. A retry gets a new attempt number. Once an attempt is accepted, `accepted.json` is also immutable and contains the exact attempt identity plus a SHA-256 digest of the accepted JSON record. Accepted-evidence reads verify the pointer identity and digest before returning the record.

Proof and post-calibration verification attempts also preserve the actual negotiated REW measurement command, playback mode, measurement mode, and stimulus. Preset 1 and Preset 2 comparison requires those settings to match pair by pair.

Raw frequency-response traces are revalidated when consumed. Stored `quality.valid` metadata is not trusted as the only integrity check.

## V1 status matrix

| Capability | Status | Notes |
| --- | --- | --- |
| REW Base64 float decoding | Implemented and CI-tested | Handles binary trace payloads |
| REW UUID measurement IDs | Implemented and CI-tested | UUIDs retained as evidence identity |
| Measure From File negotiation | Implemented and CI-tested | Uses advertised REW contract, automatic start requires REW Pro |
| Manual REW fallback | Implemented and CI-tested | Resumable checkpoint preserves negotiated settings |
| Denon MPLAY/input parsing | Implemented and CI-tested | Live input verification before audio |
| Volume/mute/power safety | Implemented and CI-tested | Audible measurement fails closed |
| Speaker Preset verification | Implemented and CI-tested | Wrong or unknown preset blocks verification audio |
| Atmos verification | Implemented and CI-tested | Encoded proof/verification evidence requires affirmative Atmos state |
| Distortion capture | Implemented and CI-tested | Used as single-level headroom/THD proxy |
| Immutable retries | Implemented and CI-tested | Failed attempts preserved |
| Accepted record digest binding | Implemented and CI-tested | Modified accepted record fails closed |
| Raw trace revalidation | Implemented and CI-tested | Frequency axis and response quality rechecked |
| REW settings evidence binding | Implemented and CI-tested | Pairwise settings mismatch rejects comparison |
| Topology normalization | Implemented and CI-tested | Read-only observation, explicit channels required when uncertain |
| Pre-Nexus measurement | Implemented, hardware-unverified | Encoded Shield measurements still require safe live receiver state |
| Nexus handoff | Implemented, hardware-unverified | Nexus remains optimizer |
| Optimized `.ady` validation | Implemented, hardware-unverified | Does not automate MultEQ transfer |
| Preset 1/2 verification runner | Implemented and CI-tested | Separate resumable datasets |
| Parent-owned verification orchestration | Implemented and CI-tested | Original autotune session owns child datasets and recommendation |
| Matched-coverage gate | Implemented and CI-tested | Position/channel/type/topology/settings must match |
| Automatic seven-metric extraction | Implemented and CI-tested | Raw provenance retained |
| Evidence-based metric confidence | Implemented and CI-tested | Numeric metric alone is not enough for acceptance |
| Automatic finalization | Implemented and CI-tested | Manual score finalization is blocked |
| Regression rollback recommendation | Implemented and CI-tested | Reject => Preset 1, win => Preset 2 |
| Final Markdown report | Implemented and CI-tested | Includes attempts, raw statistics, provenance, confidence rationale |
| First TFL hardware proof | Implemented, requires theater validation | No pass from API success alone |
| Speaker distance/trim/crossover writes | Blocked by safe capability | No raw Denon fallback |
| Programmatic preset selection | Blocked by safe capability | Human checkpoint in V1 |
| MultEQ Editor upload | Intentionally manual V1 | V2 candidate for ADB/UIAutomator |
| Nexus UI automation | Intentionally manual V1 unless supported wrapper exists | Must respect licensing |

## Parent-owned Preset verification

After the optimized `.ady` has been transferred to Speaker Preset 2, the normal parent workflow is:

```text
theater_autotune_begin_verification
theater_autotune_advance_verification
theater_autotune_resume_verification_manual   # only if REW requires it
theater_autotune_finalize_measured
```

`theater_autotune_begin_verification` inherits the original autotune session's positions, channels, topology declaration, and sweep manifest. It creates exactly one Preset 1 child session and one Preset 2 child session, stores their IDs in the parent workflow, and is idempotent.

The parent drives Preset 1 first, then Preset 2. Before every audible child measurement the active Speaker Preset is inspected. Because no proven safe EvoBurrow preset-selection write is assumed, the expected checkpoints are:

```text
Select Speaker Preset 1, then resume.
Select Speaker Preset 2, then resume.
```

After both datasets complete, `theater_autotune_finalize_measured` performs measured finalization and stores `recommendedPreset`, report path, verification path, scores, and decision state back in the parent autotune workflow.

The former manual numeric finalizer is intentionally blocked.

## Matched evidence requirements

Comparison is prohibited unless both sides contain the same accepted coverage across:

- microphone position
- channel
- measurement type
- declared topology
- sweep manifest definition
- actual negotiated REW command
- actual playback mode
- actual measurement mode
- actual file-playback stimulus

Each accepted verification record must also contain:

- immutable REW measurement UUID
- exact Speaker Preset identity
- affirmative Atmos verification
- valid raw frequency-response trace
- persisted quality evidence
- negotiated REW settings
- immutable accepted-pointer identity and SHA-256 digest

A mismatch returns an explicit diff and cannot produce an acceptance decision.

## Automatic metrics and confidence

The seven components are:

```text
bassIntegration        25%
crossoverIntegration   20%
timing                  15%
frequencyResponse       15%
channelConsistency      10%
seatConsistency         10%
headroom                 5%
```

Each component retains:

- score, 0-100
- raw statistic
- units
- evidence source
- relevant channels and positions
- assumptions/caveats
- confidence
- confidence rationale

Broad response, bass, crossover, and headroom metrics require at least three accepted speaker measurements for high confidence. Timing requires at least one position with three or more usable arrival times. Channel consistency requires at least one matched mirror-channel comparison. Seat consistency requires at least one inter-seat comparison.

Missing or low-confidence evidence stays missing or insufficient. It is not promoted merely because a numeric statistic can be calculated.

Headroom currently uses measured distortion/THD where REW exposes usable data. At one playback level this is a margin proxy only. It is not maximum SPL, compression onset, or true maximum-output capability.

## Final acceptance gate

Measured finalization performs, in order:

1. parent/child workflow-state validation
2. accepted-pointer identity and digest verification
3. raw trace revalidation
4. dataset-definition matching
5. acoustic coverage matching
6. pairwise REW measurement-setting matching
7. seven-metric derivation
8. per-component confidence evaluation
9. weighted scoring
10. baseline/candidate comparison
11. major-regression detection
12. report generation
13. parent workflow preset recommendation

Preset 2 is accepted only when all required metrics exist, all component confidence is high, coverage and measurement settings match, aggregate improvement meets the configured minimum, and no component crosses the major-regression threshold.

A rejected candidate recommends Speaker Preset 1. A passing candidate returns:

```text
status = complete
recommendedPreset = 2
```

The receiver is not automatically mutated to follow that recommendation when safe preset switching is unavailable.

## Topology policy

The workflow does not assume a fixed 7.1.4 layout. Denon/EvoBurrow topology data are read-only observations until their exact payload is validated on the target receiver. When confidence is not high, explicit channels are required and the topology is marked user-provided.

The following remain read-only/protected:

- amp assignment
- speaker existence
- terminal mapping
- subwoofer count
- impedance
- Zone 2
- HDMI configuration
- pre-out configuration

## Hardware proof policy

The first real proof is deliberately one channel, one position, TFL. Before audio the proof requires evidence for:

- REW reachability
- affirmative usable microphone input
- required REW API/Measure From File contract
- Shield ADB reachability
- exact encoded TFL file existence
- readable local REW stimulus
- Denon reachability
- correct input
- bounded volume
- unmuted state
- known and correct Speaker Preset

The proof preserves negotiated REW settings. During playback it requires affirmative Atmos state. After playback REW must contain a new UUID measurement with a valid frequency axis/response, and the accepted attempt must be digest-bound before the proof can pass.

## V1 manual boundaries

Human actions that remain acceptable in V1:

1. move the microphone
2. start REW manually if REW Pro automation is unavailable
3. complete Nexus if no supported automation hook exists
4. upload `.ady` through MultEQ Editor
5. select Speaker Preset 1 or 2 when safe programmatic switching is unavailable

## V2 blockers

A truly unattended version still needs:

- a supported safe EvoBurrow preset-selection operation
- baseline-bound, allowlisted speaker distance/trim/crossover mutations if closed-loop search is desired
- supported Nexus automation without bypassing licensing restrictions
- MultEQ Editor automation, most likely Android ADB/UIAutomator with post-action verification
- hardware-proven topology extraction against the actual X3700H/EvoBurrow payloads
- hardware-proven REW 5.40 and Shield behavior across a full theater run

## Merge gate for PR #1

Software-only V1 can be complete while PR #1 remains unmerged. Keep the PR draft until the real theater proves at least:

1. TFL, one position, Preset 1 hardware proof passes
2. encoded TFL is physically routed to TFL
3. Denon reports Atmos during playback
4. REW records a valid UUID response with the negotiated settings preserved
5. the accepted TFL attempt resolves through its immutable digest-bound pointer
6. manual REW resume works if needed on the installed license
7. a short parent-owned Preset 1/Preset 2 matched verification completes on real hardware and writes the recommendation back to the parent session

No test should be skipped or weakened merely to make CI green.

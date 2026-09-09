# First Real-Theater Hardware Proof

The first target is intentionally narrow:

```text
TFL only
one microphone position
Speaker Preset 1
safe volume
Shield encoded Atmos sweep
Denon reports Atmos
REW records a valid response
immutable TFL evidence is stored
```

Do not start with the whole theater. Prove the full path first:

```text
NVIDIA Shield -> HDMI -> Denon AVR-X3700H -> TFL -> room -> ACM1HB -> Mac -> REW 5.40
```

## Safety state

Use the Denon Media Player protocol token:

```text
DENON_SHIELD_INPUT=MPLAY
```

Keep automatic receiver writes off for the first proof:

```text
ALLOW_RECEIVER_WRITES=0
```

Manually select the Shield input, Speaker Preset 1, and a conservative measurement level. The software will verify those states, it will not trust the setup merely because a prior command returned success.

## Required preconditions

Before any sweep may start, `theater_hardware_proof` must establish all of the following:

- REW is reachable
- the required REW API contract is present
- Measure From File choices are negotiated from the installed REW build
- the microphone input check succeeds
- Shield is reachable through ADB
- the exact TFL encoded sweep exists in the expected Shield folder
- the matching local REW stimulus file is readable
- Denon is reachable and powered on
- active Denon input is the configured Shield input
- live master volume is at or below the configured measurement ceiling
- receiver is not muted
- active Speaker Preset is known and equals Speaker Preset 1

Any missing or ambiguous evidence blocks audio.

## Step 1, inspect without audio

First inspect the system:

```text
theater_inspect
rew_measurement_contract
shield_status
shield_list_sweeps({ channel: "TFL" })
```

Confirm topology is either confidently detected or explicitly supplied. Do not alter amp assignment, speaker existence, terminal mapping, subwoofer count, impedance, Zone 2, HDMI settings, or pre-out configuration to satisfy the tool.

## Step 2, run the non-audible proof plan

Use the real encoded TFL file and its corresponding local stimulus:

```text
theater_hardware_proof({
  channel: "TFL",
  fileName: "<actual TFL encoded sweep>",
  stimulusPath: "/absolute/path/to/the/corresponding/local/stimulus",
  expectedPreset: 1,
  confirmAudible: false
})
```

Expected result is `requiresConfirmation: true` with no blockers. This call must not emit audio.

If the active preset is wrong, the required checkpoint is:

```text
Select Speaker Preset 1, then resume.
```

The project does not silently switch presets because no safely verified allowlisted EvoBurrow preset-selection mutation is currently assumed.

## Step 3, perform one audible TFL proof

Only after the non-audible plan is clean:

```text
theater_hardware_proof({
  channel: "TFL",
  fileName: "<actual TFL encoded sweep>",
  stimulusPath: "/absolute/path/to/the/corresponding/local/stimulus",
  expectedPreset: 1,
  confirmAudible: true
})
```

The service performs a bounded microphone input check before playback and rechecks live receiver safety again inside the measurement path.

### REW Pro path

When the installed REW contract permits API-triggered measurement, the service prepares Measure From File, starts the REW measurement, starts the exact Shield sweep, checks Denon Atmos state while playback is active, waits for a new REW UUID measurement, captures frequency/impulse/distortion evidence, stores the immutable attempt, and stops Shield playback.

### Manual REW path

If REW requires a human-started measurement, the service returns a durable checkpoint instead of pretending automation succeeded.

In REW, start the prepared measurement so it is waiting for file playback, then call:

```text
theater_hardware_proof_resume({ sessionId: "..." })
```

The resume operation re-verifies Speaker Preset 1 and live receiver safety before starting Shield playback.

## Pass criteria

The proof passes only when:

1. a new REW measurement with a real UUID exists
2. the frequency-response trace passes the measurement-quality gate
3. Atmos verification succeeds while the encoded sweep is playing
4. the evidence is stored as an immutable attempt
5. the attempt is the deterministically accepted TFL attempt for that proof session

A 200 response from REW, EvoBurrow, ADB, or Denon is not by itself proof of acoustic success.

## Expected evidence layout

```text
sessions/<proof-session>/
  proof/
    preflight.json
    state.json
    result.json
  measurements/
    position-0/
      TFL/
        attempt-001-<rew-uuid>.json
        accepted.json
  events/
    ...
```

If the first attempt fails and is retried, both remain:

```text
attempt-001-<uuid>.json   # rejected
attempt-002-<uuid>.json   # accepted
accepted.json             # points to attempt 002
```

## Human physical-routing check

For the very first hardware proof, also verify by ear that the physical Top Front Left speaker actually emits the sweep. Software can establish encoded Atmos decode plus measured acoustic evidence, but the first real setup still needs confirmation that the intended speaker mapping agrees with the physical room.

If TFL audio comes from FL, TFR, or another speaker, stop. Treat it as a topology/routing issue. Do not compensate with EQ, trim, distance, crossover, or other calibration writes.

## After TFL passes

Proceed in this order:

1. one-position proof for the remaining active channels
2. full baseline measurement on Speaker Preset 1
3. requested multi-position baseline measurements
4. A1 Evo Nexus handoff and optimization
5. validate the resulting optimized `.ady`
6. manually transfer it to Speaker Preset 2 through MultEQ Editor
7. start matched verification with the same channels, positions, topology, sweep manifest, and measurement type
8. measure Speaker Preset 1
9. manually select Speaker Preset 2
10. measure Speaker Preset 2
11. run `theater_verification_finalize`
12. follow the returned recommendation

If the candidate loses, the required outcome is:

```text
status = regression_rejected
recommendedPreset = 1
```

Return to Speaker Preset 1 manually when safe programmatic preset switching is unavailable.

If the candidate wins:

```text
status = complete
recommendedPreset = 2
```

PR #1 should remain unmerged until this real-hardware path has been demonstrated on the target theater.

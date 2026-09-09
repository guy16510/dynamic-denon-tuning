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
negotiated REW settings are preserved
immutable digest-bound TFL evidence is stored
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

Manually select the Shield input, Speaker Preset 1, and a conservative measurement level. The software verifies those states immediately before audio. It does not trust a prior command or HTTP success response as proof.

## Required preconditions

Before any sweep may start, `theater_hardware_proof` must establish all of the following:

- REW is reachable
- the required REW API contract is present
- Measure From File choices are negotiated from the installed REW build
- the microphone input check returns affirmative usable/valid/ready evidence
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

Run:

```text
theater_inspect
rew_measurement_contract
shield_status
shield_list_sweeps({ channel: "TFL" })
```

For the first real validation, supply the known active channels explicitly rather than relying on heuristic topology inference. Denon/EvoBurrow topology observations remain read-only until their exact X3700H payload has been validated.

Do not alter amp assignment, speaker existence, terminal mapping, subwoofer count, impedance, Zone 2, HDMI settings, or pre-out configuration to satisfy the workflow.

## Step 2, run the non-audible proof plan

Use the real encoded TFL file and corresponding local stimulus:

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

The project does not silently switch presets because no safely verified allowlisted EvoBurrow preset-selection mutation is assumed.

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

The service performs a bounded microphone input check before playback and rechecks live receiver safety inside the measurement path.

### REW Pro path

When REW permits API-triggered measurement, the service:

1. negotiates Measure From File settings from the installed REW build
2. persists the selected command, playback mode, measurement mode, and stimulus identity
3. starts the REW measurement
4. starts the exact Shield sweep
5. verifies Denon Atmos state while playback is active
6. waits for exactly one new REW UUID measurement
7. captures frequency, impulse, and distortion evidence
8. validates the raw frequency axis and response
9. stores the immutable attempt
10. creates an immutable accepted pointer containing the attempt identity and SHA-256 record digest
11. stops Shield playback

### Manual REW path

If REW requires a human-started measurement, the service persists a durable checkpoint containing the negotiated REW settings. In REW, start the prepared measurement so it is waiting for file playback, then call:

```text
theater_hardware_proof_resume({ sessionId: "..." })
```

The resume operation refuses to continue if the stored microphone evidence or negotiated REW settings are missing. It re-verifies Speaker Preset 1 and live receiver safety before starting Shield playback.

## Pass criteria

The proof passes only when all of the following are true:

1. a new REW measurement with a real UUID exists
2. the raw frequency-response trace contains a usable increasing frequency axis and passes the quality gate
3. the negotiated REW measurement settings are preserved with the attempt
4. Atmos verification succeeds while the encoded sweep is playing
5. the attempt is stored immutably
6. `accepted.json` selects that attempt exactly and contains its SHA-256 digest
7. resolving accepted evidence reproduces the same digest and identity

A 200 response from REW, EvoBurrow, ADB, or Denon is not acoustic proof.

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

If the first attempt fails and a later retry passes, the failed attempt remains visible. Once an attempt is accepted, that channel's accepted selection is not silently replaced.

## Human physical-routing check

For the first hardware proof, verify by ear that the physical Top Front Left speaker actually emits the sweep. Software can establish encoded Atmos decode plus measured acoustic evidence, but the first real setup still needs confirmation that the intended channel mapping agrees with the physical room.

If TFL audio comes from FL, TFR, or another speaker, stop. Treat it as a topology/routing issue. Do not compensate with EQ, trim, distance, crossover, or other calibration writes.

## After TFL passes

Proceed in this order:

1. one-position proof for the remaining explicit active channels
2. full baseline measurement on Speaker Preset 1
3. requested multi-position baseline measurements
4. A1 Evo Nexus handoff and optimization
5. validate the resulting optimized `.ady`
6. manually transfer it to Speaker Preset 2 through MultEQ Editor
7. call `theater_autotune_begin_verification` on the original autotune session
8. select Speaker Preset 1 when requested and run `theater_autotune_advance_verification`
9. use `theater_autotune_resume_verification_manual` only if REW requires a manual start
10. after Preset 1 completes, select Speaker Preset 2 when requested
11. continue `theater_autotune_advance_verification` until both matched datasets complete
12. call `theater_autotune_finalize_measured`
13. follow the parent workflow's `recommendedPreset`

Finalization verifies accepted-record digests, raw traces, preset identities, Atmos evidence, identical coverage, identical negotiated REW settings, all seven metrics, and per-component confidence before it can recommend Speaker Preset 2.

If the candidate is rejected:

```text
recommendedPreset = 1
```

Return to Speaker Preset 1 manually when safe programmatic switching is unavailable.

If the candidate wins:

```text
status = complete
recommendedPreset = 2
```

PR #1 should remain unmerged until this real-hardware path has been demonstrated on the target theater.

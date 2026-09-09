# Dynamic Denon Tuning

Local, Codex-controlled whole-theater calibration orchestration for a Denon AVR-X3700H, REW, an NVIDIA Shield, A1 Evo Nexus, MultEQ Editor, and the Audyssey ACM1HB microphone.

> **No acoustic change is considered an improvement until it has been re-measured.**

This project orchestrates existing tools. It does not reimplement REW DSP, Atmos encoding, Audyssey/XT32, A1 Evo Nexus, or a generic Denon protocol console.

## V1 status

### Implemented and CI-tested

- EvoBurrow integration for guarded Denon inspection and allowlisted state changes
- live power, input, MPLAY token, master-volume, mute, and Atmos verification
- REW 5.40 API negotiation, UUID measurement identifiers, Base64 float trace decoding, distortion capture, REW Pro automation, and manual REW fallback
- Shield ADB connectivity, allowlisted encoded sweep lookup, playback, and stop
- immutable measurement attempts such as `attempt-001-<rew-uuid>.json`
- deterministic accepted-attempt pointers, failed/rejected evidence is retained
- resumable pre-Nexus multi-position measurement
- read-only topology normalization, or explicit user-provided channels when detection is uncertain
- A1 Evo Nexus handoff and optimized `.ady` validation
- separate, resumable Speaker Preset 1 and Speaker Preset 2 verification datasets
- preset verification before every verification sweep, wrong preset blocks audio
- matched-coverage validation across position, channel, measurement type, topology, manifest, and dataset definition
- automatic extraction of all seven weighted metrics from REW evidence
- aggregate scoring, major-regression rejection, rollback recommendation, and human-readable Markdown report
- fail-closed distance, trim, crossover, and preset writes when EvoBurrow lacks a safe allowlisted capability

### Implemented but hardware-unverified

- the complete Shield -> Denon -> room -> ACM1HB -> Mac -> REW measurement path
- exact REW 5.40 Measure From File behavior on the target Mac
- Denon AVR-X3700H topology/preset inspection against the real receiver
- encoded Atmos routing for every configured speaker
- full Nexus -> MultEQ -> Preset 2 -> measured verification loop

### Intentionally manual in V1

- move the microphone between requested positions
- start the prepared REW measurement when REW Pro automation is unavailable
- complete A1 Evo Nexus when no supported automation mechanism is configured
- transfer the optimized `.ady` through MultEQ Editor
- select Speaker Preset 1 or 2 when EvoBurrow does not expose a safe allowlisted preset-selection operation

### Blocked by missing safe EvoBurrow capability

The project will not bypass EvoBurrow by exposing arbitrary Denon protocol strings. Speaker distance, trim, crossover, and Speaker Preset writes remain blocked unless EvoBurrow exposes explicit, allowlisted, baseline-bound operations with readback/rollback protection.

### Future V2

- supported Nexus automation where licensing and tooling permit it
- Android ADB/UIAutomator automation for MultEQ Editor
- safe programmatic Speaker Preset selection
- closed-loop candidate search for distance/trim/crossover, only after safe bounded receiver mutations exist
- fully unattended operation once every human checkpoint has a supported safe automation path

## Architecture

```text
Codex
  -> dynamic-denon-tuning MCP
      -> EvoBurrow -> Denon AVR-X3700H
      -> REW 5.40 -> ACM1HB on the Mac
      -> NVIDIA Shield via ADB -> encoded Atmos sweeps over HDMI
      -> A1 Evo Nexus -> optimized .ady
      -> MultEQ Editor -> Speaker Preset 2
```

Speaker Preset 1 is the protected baseline. Speaker Preset 2 is the candidate. No acceptance decision is made from calculated settings alone.

## Requirements

- macOS measurement computer
- Node.js 22+
- Denon AVR-X3700H reachable on the LAN
- NVIDIA Shield reachable through ADB
- REW 5.40+ with local API enabled at `127.0.0.1:4735`
- REW Pro for API-triggered automatic sweep starts, manual fallback is supported without it
- EvoBurrow MCP
- A1 Evo Nexus / compatible local workspace
- MultEQ Editor for V1 `.ady` transfer
- ACM1HB microphone and a compatible Mac electret input/adapter
- encoded Atmos sweep files supplied by the A1 workflow

Do not feed 48 V phantom power into the ACM1HB. Do not commit licensed sweep media.

## Install

```bash
npm install
cp .env.example .env
```

Typical target configuration:

```text
DENON_HOST=192.168.2.8
DENON_SHIELD_INPUT=MPLAY
EVOBURROW_SERVER=/absolute/path/to/evoburrow-mcp/dist/server.mjs
A1_EVO_HOME=/absolute/path/to/a1-workspace
SHIELD_HOST=<shield-ip>
REW_MEASUREMENT_MODE=auto
ALLOW_RECEIVER_WRITES=0
```

Keep receiver writes disabled until read-only inspection and the first hardware proof pass.

## Sweep manifest

Create a local manifest from `profiles/sweeps.example.json`. Every selected channel needs both the encoded Shield file and corresponding local REW stimulus:

```json
{
  "channels": {
    "TFL": {
      "shieldFile": "TFL.wav",
      "stimulusPath": "/absolute/path/to/TFL.wav"
    }
  }
}
```

The verification runner reuses the exact same manifest for both presets.

## Important MCP operations

```text
theater_inspect
theater_detect_topology
theater_hardware_proof
theater_hardware_proof_resume

theater_autotune_start
theater_autotune_status
theater_autotune_advance
theater_autotune_resume_manual

theater_verification_start
theater_verification_advance
theater_verification_resume_manual
theater_verification_finalize

measurement_preflight
measurement_measure_channel
measurement_capture_new

rew_status
rew_measurement_contract
rew_input_level_check

shield_status
shield_list_sweeps
shield_verify_atmos
```

`theater_verification_finalize` is the preferred V1 finalizer. It derives the scores from immutable REW evidence. The legacy manual-score finalizer remains only for compatibility and is not the normal acceptance path.

## Immutable measurement layout

```text
sessions/<session-id>/
  measurements/
    position-0/
      TFL/
        attempt-001-<rew-uuid>.json
        attempt-002-<rew-uuid>.json
        accepted.json
```

A failed attempt is never replaced. `accepted.json` is a small mutable workflow pointer to one immutable attempt. Reports retain rejected-attempt history.

## Automatic measured score

The final score uses:

| Component | Weight |
| --- | ---: |
| Bass integration | 25% |
| Crossover integration | 20% |
| Timing | 15% |
| Frequency response | 15% |
| Channel consistency | 10% |
| Seat consistency | 10% |
| Headroom | 5% |

Every component retains its normalized score, raw statistic and units, evidence source, relevant channels/positions, assumptions, and confidence. Headroom derived from a single playback level is explicitly a distortion/THD proxy, not a maximum-output or compression measurement.

Final acceptance requires all of the following:

- identical baseline/candidate coverage
- valid accepted traces for every required position/channel/type
- Atmos verification where required
- all seven metrics present
- high-confidence evidence
- candidate aggregate improvement at or above the configured minimum
- no component regression beyond the configured major-regression threshold

Failure of any gate produces `status = regression_rejected` and `recommendedPreset = 1`. A winning candidate produces `status = complete` and `recommendedPreset = 2`.

## Conceptual V1 workflow

```text
Fully tune my theater
  -> inspect receiver/topology/safety
  -> verify Speaker Preset 1
  -> measure baseline at all requested positions
  -> hand off to A1 Evo Nexus
  -> validate optimized .ady
  -> human uploads .ady to Speaker Preset 2 through MultEQ Editor
  -> measure matched Speaker Preset 1 verification dataset
  -> measure matched Speaker Preset 2 verification dataset
  -> derive all seven metrics from REW evidence
  -> compare matched evidence
  -> reject regressions or accept candidate
  -> recommend Preset 1 or Preset 2
  -> write final Markdown report
```

See `docs/HARDWARE_PROOF.md` for the exact first real-theater TFL procedure and `docs/IMPLEMENTATION.md` for capability status and V2 blockers.

## Development

```bash
npm run check
npm test
```

CI runs both commands under Node 22. Hardware tests are deliberately not faked into CI, real theater validation remains a separate gate before PR #1 should merge.

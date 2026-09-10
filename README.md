# Dynamic Denon Tuning

Local, Codex-controlled whole-theater calibration orchestration for a Denon AVR-X3700H, REW, an NVIDIA Shield, A1 Evo Nexus, MultEQ Editor, and the Audyssey ACM1HB microphone.

> **No acoustic change is considered an improvement until it has been re-measured.**

This project orchestrates existing tools. It does not reimplement REW DSP, Atmos encoding, Audyssey/XT32, A1 Evo Nexus, or a generic Denon protocol console.

## V1 status

### Implemented and CI-tested

- EvoBurrow integration for guarded Denon inspection and allowlisted state changes
- live power, input, MPLAY token, master-volume, mute, Speaker Preset, and Atmos verification
- REW 5.40 API negotiation, UUID measurement identifiers, Base64 float trace decoding, distortion capture, REW Pro automation, and manual REW fallback
- Shield ADB connectivity, allowlisted encoded sweep lookup, playback, and stop
- immutable measurement attempts such as `attempt-001-<rew-uuid>.json`
- immutable accepted-attempt selection with SHA-256 binding to the exact accepted record
- failed/rejected evidence retained permanently in session history
- raw frequency traces revalidated when evidence is consumed, not trusted only from previously stored quality metadata
- negotiated REW command, playback mode, measurement mode, and file stimulus persisted with proof/verification evidence
- pairwise Preset 1/Preset 2 rejection when negotiated REW settings differ
- resumable pre-Nexus multi-position measurement
- read-only topology observations, or explicit user-provided channels when detection is uncertain
- A1 Evo Nexus handoff and optimized `.ady` validation
- separate, resumable Speaker Preset 1 and Speaker Preset 2 verification datasets
- preset verification before every verification sweep, wrong or unknown preset blocks audio
- matched-coverage validation across position, channel, measurement type, topology, manifest, and actual REW measurement settings
- automatic extraction of all seven weighted metrics from REW evidence
- evidence-based confidence for every metric, not unconditional confidence labels
- aggregate scoring, major-regression rejection, rollback recommendation, and fully auditable Markdown report
- parent-owned verification orchestration, so the original autotune session owns both verification datasets and final preset recommendation
- fail-closed distance, trim, crossover, and preset writes when EvoBurrow lacks a safe allowlisted capability
- manual numeric scores cannot finalize an autotune session

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
- hardware-validated topology parsing so explicit channels are not required
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

Speaker Preset 1 is the protected baseline. Speaker Preset 2 is the candidate. No acceptance decision is made from calculated settings or manually supplied scores alone.

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

The parent autotune workflow reuses the same manifest when it creates Preset 1 and Preset 2 verification datasets.

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

theater_autotune_begin_verification
theater_autotune_advance_verification
theater_autotune_resume_verification_manual
theater_autotune_finalize_measured

rew_status
rew_measurement_contract
rew_input_level_check

shield_status
shield_list_sweeps
shield_verify_atmos
```

The lower-level `theater_verification_*` operations remain available for diagnostics and isolated verification sessions. Normal V1 autotune should use the `theater_autotune_*verification*` operations so the parent session owns the full lifecycle.

`theater_autotune_finalize_verification`, the former manual-score finalizer, is intentionally blocked. Manual numeric component values can be analyzed with `calibration_compare_scores`, but they cannot accept Preset 2 or finish an autotune session.

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

A failed attempt is never replaced. Once `accepted.json` selects an attempt it is also append-only. The pointer contains a SHA-256 digest of the selected record, and accepted-evidence reads verify that digest before using the measurement. A modified record or pointer fails closed.

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

Every component retains its normalized score, raw statistic and units, evidence source, relevant channels/positions, assumptions, confidence, and confidence rationale. Headroom derived from a single playback level is explicitly a distortion/THD proxy, not a maximum-output or compression measurement.

Broad response, bass, crossover, and headroom metrics require at least three accepted speaker measurements to earn high confidence. Timing requires usable multi-channel arrival evidence. Channel and seat consistency require actual matched comparisons. Having a numeric metric is not sufficient by itself for final acceptance.

Final acceptance requires all of the following:

- identical baseline/candidate coverage
- valid accepted traces for every required position/channel/type
- identical negotiated REW command/playback/mode/stimulus for each matched pair
- affirmative Speaker Preset identity in each immutable record
- affirmative Atmos verification for encoded verification sweeps
- all seven metrics present
- high-confidence evidence for every component
- candidate aggregate improvement at or above the configured minimum
- no component regression beyond the configured major-regression threshold

Failure of any gate produces a rejection and `recommendedPreset = 1`. A winning candidate produces `status = complete` and `recommendedPreset = 2`.

## Conceptual V1 workflow

```text
Fully tune my theater
  -> inspect receiver/topology/safety
  -> verify Speaker Preset 1
  -> measure baseline at all requested positions
  -> hand off to A1 Evo Nexus
  -> validate optimized .ady
  -> human uploads .ady to Speaker Preset 2 through MultEQ Editor
  -> parent session creates matched Preset 1 and Preset 2 verification children
  -> manually select Preset 1 when requested
  -> measure Preset 1 verification dataset
  -> manually select Preset 2 when requested
  -> measure Preset 2 verification dataset
  -> validate accepted-record digests and matched REW settings
  -> derive all seven metrics from REW evidence
  -> compare matched high-confidence evidence
  -> reject regressions or accept candidate
  -> write recommended preset back into the parent autotune workflow
  -> write final Markdown report with attempt history and raw evidence provenance
```

See `docs/HARDWARE_PROOF.md` for the exact first real-theater TFL procedure and `docs/IMPLEMENTATION.md` for capability status and V2 blockers.

## Development

```bash
npm run check
npm test
```

CI runs both commands under Node 22. Hardware tests are deliberately not faked into CI. Real theater validation remains a separate gate before PR #1 should merge.

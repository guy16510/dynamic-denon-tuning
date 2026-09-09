# Dynamic Denon Tuning

Local, Codex-controlled whole-theater calibration orchestration for a Denon AVR-X3700H, REW, an NVIDIA Shield, A1 Evo Nexus, and the Audyssey ACM1HB microphone.

The governing rule is:

> **No acoustic change is considered an improvement until it has been re-measured.**

This repository does not implement a replacement room-correction DSP, FIR engine, Atmos encoder, or Audyssey optimizer. It orchestrates existing tools, preserves evidence, applies safety gates, and rejects unverified changes.

## Current status

V1 core is implemented as a resumable Node.js MCP server.

Implemented:

- EvoBurrow MCP child-server integration
- read-only Denon inspection and snapshots
- baseline-bound safe Denon input/volume/mute changes through EvoBurrow
- Speaker Preset status inspection
- REW readiness and microphone-level checks
- REW Measure From File configuration
- REW automated measurement start when REW Pro permits it
- manual REW fallback when API-triggered sweeps are unavailable
- NVIDIA Shield control through ADB
- deterministic per-channel Atmos sweep playback
- Atmos decoder verification through the AVR
- multi-position, resumable measurement workflow
- append-only measurement/session artifacts
- raw REW `.mdat` session archive
- Nexus handoff instead of reimplementing A1 optimization
- MultEQ Editor manual transfer checkpoint for V1
- transparent calibration scoring
- regression rejection
- immutable verification result and Markdown report
- fail-closed placeholders for unsupported Denon distance, trim, and crossover writes

Not yet implemented:

- automated MultEQ Editor transfer
- safe allowlisted Denon distance/trim/crossover mutation through EvoBurrow
- fully automatic extraction of measured score components from all REW traces
- automated search over crossover/delay/trim candidates
- Android UIAutomator transfer flow

## Important corrections to the original design

### REW Pro is required for fully automatic sweeps

REW's API can be used for general control without Pro, but REW documents that **automated sweep measurements through the API require a Pro upgrade license**.

The server therefore supports three modes:

```text
REW_MEASUREMENT_MODE=auto
REW_MEASUREMENT_MODE=pro
REW_MEASUREMENT_MODE=manual
```

`auto` tries the API and falls back to a human-started measurement when REW reports that Pro is required.

For the target experience where Codex starts every sweep with no REW interaction, plan on REW Pro in addition to the MultEQ Editor app.

### Denon speaker writes intentionally fail closed

The current EvoBurrow protected mutation surface allows baseline-bound changes such as input, volume, mute, and power. It does not currently expose safe arbitrary writes for speaker distance, channel trim, or crossover.

This project does **not** bypass that safety boundary by exposing raw Denon protocol strings.

Until EvoBurrow adds verified, allowlisted, rollback-capable implementations, these MCP tools deliberately return a capability error:

```text
theater_set_distance
theater_set_level
theater_set_crossover
```

That is a feature, not unfinished error handling.

## Architecture

```text
                         Codex
                           |
                           | MCP
                           v
               denon-atmos-autotune
                    Node.js MCP
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
      EvoBurrow           REW          NVIDIA Shield
          |                |                |
          v                |                | Atmos files
     AVR-X3700H <----------+----------------+
          |                                 |
          +------------- Room --------------+
                           |
                     ACM1HB -> Mac

                        A1 Evo Nexus
                             |
                       optimized.ady
                             |
                      MultEQ Editor
                             |
                       Speaker Preset 2
```

## Hardware path

```text
Shield -> HDMI -> Denon -> selected speaker -> room -> ACM1HB -> Mac -> REW
```

For normal REW/Nexus measurement, the ACM1HB must feed the Mac through a compatible electret microphone input or USB adapter. Do not feed 48 V phantom power into the ACM1HB.

The mic returns to the Denon Setup Mic jack only for the initial Audyssey/MultEQ Editor seed calibration when a baseline `.ady` does not already exist.

## Requirements

- macOS measurement computer
- Node.js 22
- Denon AVR-X3700H reachable on the LAN
- NVIDIA Shield reachable through ADB
- REW 5.40+ with local API enabled at `127.0.0.1:4735`
- REW Pro for API-triggered fully automatic sweep measurement
- A1 Evo Nexus / A1 Evo AcoustiX workspace
- EvoBurrow MCP
- Audyssey MultEQ Editor app for XT32 `.ady` transfer in V1
- ACM1HB microphone and compatible Mac electret input
- encoded Atmos sweep files supplied by the A1 workflow

Do not commit proprietary or licensed sweep media to this repository.

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` for your Mac:

```text
DENON_HOST=192.168.2.8
EVOBURROW_SERVER=/absolute/path/to/evoburrow-mcp/dist/server.mjs
A1_EVO_HOME=/absolute/path/to/a1-workspace
SHIELD_HOST=<shield-ip>
REW_MEASUREMENT_MODE=auto
ALLOW_RECEIVER_WRITES=0
```

Keep `ALLOW_RECEIVER_WRITES=0` until read-only inspection and hardware validation are complete.

## Sweep manifest

Copy the example:

```bash
cp profiles/sweeps.example.json profiles/sweeps.local.json
```

For every configured channel, map:

- `shieldFile`, encoded sweep filename on the Shield
- `stimulusPath`, corresponding local stimulus file REW should use for Measure From File

Example:

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

Local manifests and media paths should not be committed if they contain private machine paths or licensed media.

## MCP configuration

The repository includes `.mcp.json`. Once dependencies are installed, the server entry point is:

```text
node src/index.js
```

Core tools include:

```text
theater_inspect
theater_snapshot
theater_autotune_start
theater_autotune_status
theater_autotune_advance
theater_autotune_resume_manual
theater_autotune_finalize_verification

measurement_preflight
measurement_measure_channel
measurement_capture_new

shield_status
shield_list_sweeps
shield_play_sweep
shield_stop
shield_verify_atmos

rew_status
rew_input_level_check

calibration_score
calibration_compare_scores
calibration_crossover_candidates
calibration_delay_candidate
```

## V1 workflow

### 1. Hardware proof

Verify the ACM1HB is visible to macOS and REW, then run:

```text
measurement_preflight
rew_input_level_check
```

Do not proceed until the input is real, unclipped, and stable.

### 2. Shield proof

```text
shield_status
shield_list_sweeps
shield_play_sweep
shield_verify_atmos
shield_stop
```

Verify the expected physical speaker actually fires.

### 3. AVR proof

```text
theater_inspect
theater_snapshot
```

Confirm the live model/topology/preset state and save the original `.ady` independently.

### 4. Start a calibration session

Conceptually:

```text
theater_autotune_start({
  positions: 3,
  baselineAdy: "/path/to/baseline.ady",
  sweepManifestPath: "/path/to/profiles/sweeps.local.json"
})
```

The session is resumable. Codex asks for one microphone movement at a time.

### 5. Measure

With REW Pro, each channel can be triggered through the API.

Without REW Pro, the server prepares the exact measurement and returns a manual checkpoint. Start that measurement in REW, then call:

```text
theater_autotune_resume_manual
```

Raw per-channel evidence is kept in the session and the full REW set is saved as:

```text
rew/theater.mdat
```

### 6. Nexus

After all requested positions pass their quality gates, the workflow creates a Nexus handoff containing:

```text
nexus/input.ady
nexus/handoff.json
rew/theater.mdat
```

V1 expects the user to complete A1 Evo Nexus optimization and provide `optimized.ady`.

### 7. MultEQ Editor

Transfer the optimized calibration to **Speaker Preset 2**.

Do not overwrite Preset 1.

### 8. Verification

Perform level-matched measured comparisons of Preset 1 and Preset 2. Only measured evidence should be converted into the score components.

Finalize with all seven metrics:

```text
bassIntegration
crossoverIntegration
timing
frequencyResponse
channelConsistency
seatConsistency
headroom
```

The candidate is rejected if:

- aggregate measured score does not improve enough
- any major component regresses beyond the configured threshold
- evidence coverage is not high confidence

A rejected candidate does not become the recommended calibration.

## Session layout

```text
sessions/<session-id>/
├── session.json
├── workflow.json
├── baseline/
│   ├── preflight.json
│   ├── avr.json
│   └── calibration.ady
├── measurements/
│   ├── position-0/
│   ├── position-1/
│   └── position-2/
├── rew/
│   └── theater.mdat
├── nexus/
│   ├── input.ady
│   ├── handoff.json
│   └── optimized.ady
├── optimized/
│   └── verification.json
├── events/
│   └── <append-only event files>
└── report.md
```

Raw artifacts are never intentionally overwritten. Only the resumable `workflow.json` state document is mutable.

## Safety model

Before audible tests:

- verify the Denon and Shield are reachable
- verify the expected input
- bound measurement volume
- verify REW input is active
- verify expected channel/file mapping
- verify Atmos decode for encoded sweeps
- stop on routing mismatch, clipping, missing timing evidence, or obvious distress

Receiver writes are opt-in and must go through an allowlisted adapter. This project never exposes a generic `sendDenonCommand(string)` tool.

## Development

```bash
npm run check
npm test
```

Hardware-independent tests cover scoring, acceptance/rejection, crossover/delay proposals, report output, immutable session evidence, and path traversal protection.

See `docs/IMPLEMENTATION.md` for phase status and the remaining work required to reach the final one-command experience.

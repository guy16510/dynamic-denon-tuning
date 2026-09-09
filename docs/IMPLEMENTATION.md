# Implementation status and roadmap

## Target

The end state is:

```text
Fully tune my theater
```

with the human moving the microphone between requested positions and the system doing everything else that can be made deterministic and safe.

## Current architecture decisions

### 1. Orchestrate, do not duplicate

Use:

- REW for measurement and acoustic traces
- A1 Evo Nexus for XT32 optimization
- EvoBurrow for AVR safety, snapshots, preset context, and guarded receiver operations
- Shield ADB for deterministic encoded Atmos playback
- MultEQ Editor for the supported `.ady` transfer path in V1

Do not build another FFT engine, FIR optimizer, Atmos encoder, Audyssey implementation, or generic Denon protocol console.

### 2. Resumable workflow instead of a blocking MCP call

A real calibration contains human checkpoints:

- move microphone
- possibly start REW measurement manually
- complete Nexus in V1
- transfer `.ady` in V1

`theater_autotune_start` creates a durable session. `theater_autotune_advance` resumes from the persisted state. A failed channel measurement can be retried without discarding the rest of the session.

### 3. Fail closed at capability boundaries

The current EvoBurrow safe Denon mutation surface does not expose speaker distance, trim, or crossover writes. These operations are not replaced with raw Denon protocol commands.

The next implementation for those settings belongs behind EvoBurrow-style controls:

```text
read baseline
create exact diff
bind plan to baseline fingerprint
explicitly authorize plan
apply one allowlisted setting
read back
re-measure
accept or restore
```

### 4. Measurement evidence is immutable

The workflow may update `workflow.json`, but raw measurements, baseline artifacts, Nexus outputs, event records, verification evidence, and the final report are append-only within a session.

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| Hardware proof | Ready for hardware test | REW audio and input-level inspection exposed |
| Shield proof | Implemented | ADB connect, list, play, stop, device status |
| REW MCP/API | Implemented with license gate | Auto trigger requires REW Pro, manual fallback supported |
| Denon MCP | Partially implemented | Inspection/snapshot/safe state changes available, speaker tuning writes blocked |
| Full channel measurement | Implemented orchestration | Requires actual sweep manifest and hardware validation |
| Multi-position measurement | Implemented orchestration | Resumable and per-channel failure aware |
| Nexus handoff | Implemented | Interactive V1 unless an approved local wrapper is configured |
| XT32 deployment | Manual V1 | MultEQ Editor checkpoint |
| Closed-loop speaker setting search | Not yet safe to enable | Requires allowlisted Denon speaker-setting mutations |
| Final measured acceptance | Implemented | Candidate must pass complete weighted evidence gate |
| Fully unattended tuning | Not yet | Requires REW Pro, safe Denon speaker writes, and automated `.ady` transfer |

## Next engineering work

### A. Hardware smoke-test harness

Add opt-in scripts that never run in CI:

```text
npm run smoke:rew
npm run smoke:shield
npm run smoke:denon
npm run smoke:channel -- TFL
```

Each command should be read-only unless explicitly told to make a bounded audible test.

### B. Determine actual topology from artifacts and AVR state

Replace the default 7.1.4 channel list with detected channels from the seed `.ady` plus EvoBurrow speaker inventory.

Never infer that a physical speaker exists from a generic X3700H capability table.

### C. Stronger measurement quality gate

Use REW evidence to calculate, not guess:

- signal present
- calibrated/relative level sanity
- clipping/overload
- timing reference validity
- impulse validity
- repeated measurement consistency
- wrong-speaker/routing similarity

A channel that fails should be retried in isolation.

### D. Measured speaker capability extraction

For each speaker, derive a usable low-frequency region from multiple positions and generate only candidate crossovers that stay above the measured extension floor.

Do not treat manufacturer frequency response as the deciding input.

### E. Safe crossover/delay/trim mutation path

Extend EvoBurrow, or consume a future EvoBurrow tool, rather than adding generic AVR commands here.

Each candidate must follow:

```text
propose -> predict -> apply -> read back -> measure -> compare -> keep/rollback
```

Prediction is for search efficiency. Measurement decides acceptance.

### F. Automatic score extraction

Derive the seven normalized component metrics from defined REW evidence and store the math/provenance in the session. Avoid LLM-generated scores without traceable calculations.

### G. Preset 1/2 verification runner

Use EvoBurrow's protected preset-audit and REW measurement mechanisms to gather level-matched baseline/candidate traces. The finalizer already rejects regressions once measured component scores exist.

### H. Nexus automation

Keep the optimizer owned by A1. For personal use, a local wrapper can be added only if it follows the A1 project license and does not redistribute restricted code/assets.

### I. MultEQ Editor automation

V2 can use Android + ADB/UIAutomator to operate the supported app workflow. Do not reverse-engineer an undocumented calibration upload protocol as the first implementation.

## Paid components

For the exact high-automation target, budget for both:

1. **Audyssey MultEQ Editor App**, supported `.ady` transfer path used by A1 workflows.
2. **REW Pro**, required by REW for API-triggered automated sweep measurements.

Without REW Pro, the system still handles setup, Shield playback, evidence capture, session state, analysis, Nexus handoff, and verification, but REW sweep start requires a manual checkpoint or separate UI automation.

## Definition of done for this V1 branch

This branch is ready to merge once:

- unit tests pass
- syntax check passes
- read-only hardware preflight succeeds on the target Mac
- Shield ADB proof succeeds
- one channel sweep is routed to the expected physical speaker
- the REW file-playback endpoint shapes are confirmed against the installed REW build
- a calibration session can be started and resumed without losing artifacts

It should **not** be called fully autonomous until the blocked Denon speaker-setting mutation and `.ady` transfer pieces are implemented and verified on the actual receiver.

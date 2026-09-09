# First-Channel Hardware Proof

Run this before a full calibration session. The goal is to prove one complete path end to end:

```text
Shield -> HDMI -> Denon -> TFL -> room -> ACM1HB -> Mac -> REW
```

Do not start by measuring the entire theater. A bad input token, wrong Shield file, unsupported REW mode, muted AVR, or routing problem should fail on one channel first.

## Receiver input token

`DENON_SHIELD_INPUT` is a Denon protocol token, not the friendly input label shown in the AVR UI.

For the Media Player input use:

```text
DENON_SHIELD_INPUT=MPLAY
```

Keep receiver writes disabled while proving the path:

```text
ALLOW_RECEIVER_WRITES=0
```

Set the Denon to the Shield input and a conservative measurement volume manually before the proof.

## 1. Verify the REW contract

Run:

```text
rew_measurement_contract
```

The server reads the choices advertised by the installed REW build instead of assuming strings. The required concepts are:

```text
measurement command: SPL
playback mode:        From file
measurement mode:     Single
```

`SPL` is the measurement command. It must not be written into REW's measurement-mode setting.

## 2. Plan the proof without audio

Pick one encoded Atmos channel file, TFL is a useful first choice because a routing mistake is obvious.

Conceptually:

```text
theater_hardware_proof({
  channel: "TFL",
  fileName: "<actual TFL file on Shield>",
  stimulusPath: "/absolute/path/to/the/corresponding/local/stimulus",
  confirmAudible: false
})
```

This emits no sweep. It checks:

- REW is reachable
- REW advertises the required Measure From File contract
- Shield ADB is reachable
- the requested encoded file exists in the Shield channel directory
- the local stimulus file is readable
- the Denon is powered on
- the Denon reports the configured Shield input
- the Denon master volume is no louder than the configured measurement ceiling
- the Denon is unmuted

Resolve every blocker before continuing.

## 3. Run one audible proof

When the non-audible plan is clean, repeat with:

```text
confirmAudible: true
```

Before playing the sweep the server performs a bounded REW microphone input-level check and re-verifies live Denon safety.

With REW Pro, the proof can run automatically.

Without REW Pro, the server prepares the measurement and returns a session checkpoint. In REW, start the prepared measurement so it is waiting for file playback, then call:

```text
theater_hardware_proof_resume({ sessionId: "..." })
```

The resume call starts the Shield sweep itself, polls the Denon for Atmos, waits for the new REW measurement, stores the traces, and stops Shield playback. Do not manually race a separate ADB playback command against REW.

## Pass criteria

The hardware proof passes only when both are true:

1. REW captured a measurement that passed the measurement-quality gate.
2. The Denon reported Atmos while the encoded sweep was playing.

The proof is stored as an immutable session including:

```text
proof/preflight.json
proof/state.json
proof/result.json
measurements/position-0/TFL.json
events/
```

## Physical routing check

The software can verify Atmos decoding and captured acoustic evidence, but the first proof still needs a human sanity check that the expected physical speaker fired.

If the TFL file audibly comes from FL, TFR, or another speaker, stop. Treat that as a routing/topology problem. Do not compensate for it with EQ, trim, distance, or crossover changes.

Only after one channel passes should the project move on to an all-channel, one-position proof and then multi-position calibration.

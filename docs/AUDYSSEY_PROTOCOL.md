# Audyssey protocol research, AVR-X3700H

## Status

**Implemented tooling, hardware-unverified protocol semantics.** No undocumented measurement command is enabled in the application or MCP surface.

The receiver is known to participate in Audyssey calibration and produce `ResponseData` in `.ady` data. That does not prove the ACM1HB ADC is available as a general-purpose input during ordinary corrected playback.

## Research rule

Observe normal MultEQ Editor to AVR traffic on the local network. Do not bypass authentication, encryption, licensing, or DRM. Never promote a packet pattern into an application command until repeated controlled experiments establish its semantics.

## Controlled experiments

1. Experiment A: start calibration, measure one fixed speaker, capture traffic, record exact human action times.
2. Experiment B: repeat the same speaker and microphone position, identify stable and variable packet fields.
3. Experiment C: change only the speaker, compare capture signatures.
4. Experiment D: change only microphone position, compare signatures.
5. Experiment E: finish calibration, export `.ady`, correlate captured payload sizes/signatures with the resulting `ResponseData` length and content where legally/technically observable.
6. H5 correction test: leave ACM1HB and speaker fixed, capture MultEQ OFF, then ON, with every other setting and stimulus matched.

## Evidence to document

Receiver discovery, port(s), session establishment, start/finish behavior, channel selection, sweep trigger, response framing, sample encoding, position transitions, calibration upload, and preset selection must each have packet evidence or remain `unknown`.

If traffic is encrypted, document that fact and stop protocol decoding at the encryption boundary. The application must remain in guided mode.

## Hard post-correction gate

The native measurement path becomes `post-correction-capable` only after a controlled OFF/ON experiment shows a material response difference, the active preset is independently verified, and the capture path itself is verified. An effectively unchanged OFF/ON capture is classified `pre-correction-only` and cannot validate candidate improvement.

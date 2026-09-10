# AVR-X3700H V2 hardware validation

Software tests and mocks never count as hardware proof. Record receiver firmware, REW version, EvoBurrow version, Nexus version, source hashes, target profile hash, room/mic setup, and every operator action for each gate.

## H1, real `.ady` import

Import an existing real `.ady` without writing the receiver. Confirm every channel and mic position, validate `ResponseData`, export each impulse to REW text, inspect channel identity/timing/response plausibility, and retain the original SHA-256.

## H2, fresh ACM1HB calibration

Connect ACM1HB only to the Denon, run a fresh normal Audyssey calibration, export `.ady`, then repeat H1. This proves the initial native measurement path without a Mac microphone.

## H3, REW correlation

For one channel and fixed position, correlate the exported Audyssey impulse with REW/Audyssey views. Confirm channel identity, timing direction, and derived frequency response before using it for optimization.

## H4, protocol observation

Capture normal MultEQ Editor to AVR traffic for the controlled experiments in `docs/AUDYSSEY_PROTOCOL.md`. Do not enable arbitrary raw packet execution.

## H5, corrected-signal proof

Do not move ACM1HB. Use one speaker and matched stimulus/settings. Capture A with MultEQ OFF and B with MultEQ ON. Choose a calibration where correction should create a clear measurable difference. If A and B are effectively identical, classify native capture as `pre-correction-only`. Only graduate when active preset/correction and the capture path are independently verified and the measured response changes materially.

## H6 through H10

H6: enable post-correction native capability only if H5 passes. H7: apply one legal candidate to Preset 2, read it back, measure, accept/reject, and prove rollback/champion restore. H8: repeat for one speaker pair. H9: validate subwoofer/crossover integration. H10: run the whole theater.

## Mutation prerequisites

Automatic full-theater writes remain disabled until measurement direction, receiver mutation direction, rollback, and Preset 1 protection are all hardware-verified. `ALLOW_RECEIVER_WRITES=0` remains the default even after software validation.

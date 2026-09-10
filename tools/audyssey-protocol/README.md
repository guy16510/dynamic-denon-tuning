# Audyssey protocol research tools

These tools compare packet metadata and payload signatures from normal local network observation. They deliberately do not contain undocumented Denon commands, credentials, decryption, authentication bypasses, DRM bypasses, or copyrighted test audio.

Export each experiment into newline-delimited JSON with one packet per line:

```json
{"timestamp":0.125,"direction":"app->avr","srcPort":50000,"dstPort":12345,"length":144,"payloadHex":"0011aa..."}
```

`payloadHex` is optional. Do not commit captures containing private network data. Prefer sanitized synthetic fixtures in the repository.

Analyze one capture:

```bash
node tools/audyssey-protocol/analyze-capture.js experiment-a.jsonl
```

Compare two controlled experiments:

```bash
node tools/audyssey-protocol/compare-captures.js experiment-a.jsonl experiment-b.jsonl
```

The output is evidence for protocol research only. A recurring payload signature is not automatically a command, response, microphone sample, or calibration frame. Correlate changes against a controlled hardware action before documenting semantics.

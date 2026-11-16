# phoenix-hatch

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/aboybro/phoenix-hatch/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/aboybro/phoenix-hatch/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A baby phoenix hatching from a crystal egg, wings of fire bursting toward the
camera — a single image made to excite an AI judge, entered in
[make.fun's "Make the AI judge excited" bounty](https://make.fun/bounty/ai-excited-01).

## How it works

`main.ts` (Node 22, standard library only) reads `entry.png`, applies a
deterministic fire-glow enhancement — richer saturation, stronger contrast,
warmer highlights on the flames — and writes the result to
`$MAKEFUN_OUTPUT_DIR/entry.png` (default `/output`). The output is a
1024×1024 PNG under 1 MiB, and every step is deterministic, so both grading
runs write identical bytes.

Run it locally:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

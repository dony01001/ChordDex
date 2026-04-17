# ChordDex

Real-time chord & note recognizer for Ableton Move.
Tool module for the [Schwung](https://github.com/charlesvestal/schwung) platform.

Catch 'em all.

## Features

- Detects chords played on the Move pads and displays the name on the 128×64 screen
- Supports triads, 6ths, 7ths, 9ths, sus, add, power, and slash chords
- Uses the bass note as a tiebreaker for ambiguous voicings (e.g. `C6` vs `Am7`)
- Pokédex-inspired pad coloring:
  - **Root** (C): white
  - **In-scale** notes (C major): red
  - **Out-of-scale** notes: off
  - **Pressed** pads: yellow
- Big 2x-scaled chord name on screen with auto-shrink
- Back button exits cleanly to the Tools menu

## Install

Requires [Schwung](https://github.com/charlesvestal/schwung) installed on the Move.

### Option A — Schwung GitHub installer (recommended)

From the Schwung directory on your Move (or wherever you run its scripts):

```bash
./scripts/install.sh install-module-github dony01001/ChordDex
```

### Option B — Clone and SSH

```bash
git clone https://github.com/dony01001/ChordDex.git
cd ChordDex
bash install.sh
```

Environment (Option B):
- `MOVE_HOST` — hostname of the Move (default `move.local`)
- `MOVE_USER` — SSH user (default `root`)

Restart the Move to load the module. Then open it from the Tools menu.

## Files

- `module.json` — module manifest (id, capabilities)
- `ui.js` — tool UI: chord detection, LED painting, screen rendering
- `install.sh` — deploys `module.json` + `ui.js` to the Move via SSH

## Notes

- No audio: the module does not route pad input to a synth. It's a didactic
  overlay, not an instrument.
- Scale is currently hardcoded to C major. Configurable key/scale is a planned
  addition.
- The Move's isomorphic pad layout is: MIDI = `68 + row*8 + col`, pitch class
  `= (9 + row*5 + col) mod 12` (bottom-left = A).

## License

MIT

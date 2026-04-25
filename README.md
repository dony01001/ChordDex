# ChordDex

Real-time chord & note recognizer for Ableton Move.
It's a didactic overlay for Move's chromatic mode: play any combination of pads and it names the chord on screen (plus the individual notes)
Tool module for the [Schwung](https://github.com/charlesvestal/schwung) platform.



## Features

- Detects chords played on the Move pads and displays the name on the 128×64 screen
- Supports triads, 6ths, 7ths, 9ths, 11ths, 13ths, sus, add, power, slash chords, and shell voicings (e.g. `C-E-B` = `Cmaj7`)
- Uses the bass note as a tiebreaker for ambiguous voicings (e.g. `C6` vs `Am7`)
- Chord name persists on screen after release with a dither fade until the next chord is played
- Staggered release debounce (150ms): slow releases keep updating the chord name, fast releases freeze the peak voicing
- Pad coloring:
  - **Root** (C): white
  - **In-scale** notes (C major): red
  - **Out-of-scale** notes: off
  - **Pressed** pads: bright yellow
  - **Ghost** (last chord's pads): dim yellow
- On exit, pads keep the last ChordDex coloring so the chord stays visible for replaying or programming into the sequencer
- Big 2x-scaled chord name on screen with auto-shrink


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

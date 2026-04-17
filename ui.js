// ChordDex — tool module for Schwung / Ableton Move
// Real-time chord & note recognizer. Lights pads by scale, detects
// played chords (triads, 7ths, 9ths, sus, add, slash), shows name on screen.

var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// All intervals mod 12. Patterns are pitch-class sets, not voicings.
// Order matters only for tie-breaking when multiple patterns match.
var CHORD_PATTERNS = [
  // 6-note extensions
  { i: [0,2,4,5,7,11], n: 'maj11' },
  // 5-note (9ths/11ths/13ths)
  { i: [0,2,4,7,10], n: '9'     },
  { i: [0,2,4,7,11], n: 'maj9'  },
  { i: [0,2,3,7,10], n: 'm9'    },
  { i: [0,1,4,7,10], n: '7b9'   },
  { i: [0,3,4,7,10], n: '7#9'   },
  { i: [0,2,4,6,10], n: '9b5'   },
  { i: [0,2,4,8,10], n: '9#5'   },
  { i: [0,2,4,7,9],  n: '6/9'   },
  { i: [0,2,5,7,10], n: '11'    },
  { i: [0,3,5,7,10], n: 'm11'   },
  { i: [0,4,7,9,10], n: '13'    },
  { i: [0,3,7,9,10], n: 'm13'   },
  { i: [0,4,7,9,11], n: 'maj13' },
  // 4-note sixths and sevenths
  { i: [0,4,7,11],   n: 'maj7' },
  { i: [0,4,7,10],   n: '7'    },
  { i: [0,3,7,10],   n: 'm7'   },
  { i: [0,3,7,11],   n: 'mM7'  },
  { i: [0,4,6,10],   n: '7b5'  },
  { i: [0,3,6,10],   n: 'm7b5' },
  { i: [0,3,6,9],    n: 'dim7' },
  { i: [0,4,8,10],   n: '7#5'  },
  { i: [0,5,7,10],   n: '7sus4'},
  { i: [0,4,7,9],    n: '6'    },
  { i: [0,3,7,9],    n: 'm6'   },
  { i: [0,2,4,7],    n: 'add9' },
  { i: [0,2,3,7],    n: 'madd9'},
  // Triads
  { i: [0,4,7],      n: ''     },
  { i: [0,3,7],      n: 'm'    },
  { i: [0,3,6],      n: 'dim'  },
  { i: [0,4,8],      n: 'aug'  },
  { i: [0,2,7],      n: 'sus2' },
  { i: [0,5,7],      n: 'sus4' },
  // Dyads
  { i: [0,7],        n: '5'    },
];

var activeNotes   = {};
var lastVelocity  = 0;
var lastRawNote   = -1;
var dirty         = true;

// Progressive LED paint state (avoid flooding internal MIDI queue at init).
var paintIndex    = 0;  // next pad to paint (0..31), 32 = done
var PAINT_PER_TICK = 4;

// Pokeball splash on tool open (frames of ticks).
var splashTicks   = 0;
var SPLASH_FRAMES = 45; // how long the splash stays before fading to scale

// Pokédex palette: white screen, red body, yellow button.
var LED_ROOT    = 120; // White — C (root), like the Pokédex screen
var LED_SCALE   = 1;   // BrightRed — in-scale notes, Pokédex body
var LED_OUT     = 0;   // Black — out-of-scale, off
var LED_PRESSED = 7;   // VividYellow — pressed pad, Pokédex button

// Pokeball palette
var LED_POKE_RED    = 127; // pure red — top half
var LED_POKE_BLACK  = 0;   // center band
var LED_POKE_WHITE  = 120; // bottom half + button
var LED_POKE_BUTTON = 126; // button accent (green, like a Pokéball button)

// C major scale pitch classes: C D E F G A B
var SCALE_MAJOR = { 0:1, 2:1, 4:1, 5:1, 7:1, 9:1, 11:1 };

function padLed(note, vel) {
  if (note < 68 || note > 99) return;
  // Tool modules use 0x09 prefix (see shared/input_filter.mjs setLED).
  move_midi_internal_send([0x09, 0x90, note, vel]);
}

function baseColor(note) {
  var p = pc(note);
  if (p === 0) return LED_ROOT;
  if (SCALE_MAJOR[p]) return LED_SCALE;
  return LED_OUT;
}

function paintBase() {
  for (var n = 68; n <= 99; n++) padLed(n, baseColor(n));
}

function schedulePaintBase() {
  paintIndex = 0;
}

// Pokéball splash: 4 rows x 8 cols. Row 0 = bottom.
// Top two rows red, row 1 is the black band with a white button center,
// bottom row white. Nostalgic Pokédex vibe.
function pokeballColor(note) {
  var base = note - 68;
  var r = Math.floor(base / 8);
  var c = base - r * 8;
  if (r === 3) return LED_POKE_RED;        // top row
  if (r === 2) return LED_POKE_RED;        // upper middle
  if (r === 1) {                           // band row with center button
    if (c === 3 || c === 4) return LED_POKE_BUTTON;
    return LED_POKE_BLACK;
  }
  return LED_POKE_WHITE;                   // bottom row
}

function paintPokeball() {
  for (var n = 68; n <= 99; n++) padLed(n, pokeballColor(n));
}

function paintTick() {
  if (paintIndex >= 32) return;
  var end = Math.min(paintIndex + PAINT_PER_TICK, 32);
  for (var i = paintIndex; i < end; i++) {
    var note = 68 + i;
    // Preserve held pads with pressed color.
    if (activeNotes[note]) padLed(note, LED_PRESSED);
    else padLed(note, baseColor(note));
  }
  paintIndex = end;
}

function padsAllOff() {
  for (var n = 68; n <= 99; n++) padLed(n, 0);
}

// Absolute pitch in semitones (no mod 12) for a pad MIDI number.
function absSemi(note) {
  var base = note - 68;
  var r = Math.floor(base / 8);
  var c = base - r * 8;
  return 9 + r * 5 + c;
}

function semiHasActive(ts) {
  for (var k in activeNotes) {
    if (absSemi(+k) === ts) return true;
  }
  return false;
}

// Light all pads that produce the exact same pitch (isomorphic duplicates).
function paintTwins(note, on) {
  var ts = absSemi(note);
  for (var n = 68; n <= 99; n++) {
    if (absSemi(n) !== ts) continue;
    if (on) {
      padLed(n, LED_PRESSED);
    } else {
      if (semiHasActive(ts)) padLed(n, LED_PRESSED);
      else padLed(n, baseColor(n));
    }
  }
}

// Move pad layout: MIDI = 68 + row*8 + col, pitch = A(9) + row*5 + col semitones.
// Rows are sequential (8 MIDI notes apart) but musically 5 semitones apart.
function pc(note) {
  var base = note - 68;
  var r = Math.floor(base / 8);
  var c = base - r * 8;
  return ((9 + r * 5 + c) % 12 + 12) % 12;
}

function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) === -1) return false;
  return true;
}

function getChord() {
  var nums = [];
  for (var k in activeNotes) nums.push(+k);
  nums.sort(function(a, b) { return a - b; });

  if (nums.length === 0) return null;

  var pcSet = {};
  for (var i = 0; i < nums.length; i++) pcSet[pc(nums[i])] = 1;
  var pcs = [];
  for (var p in pcSet) pcs.push(+p);
  pcs.sort(function(a, b) { return a - b; });

  // Unique pitch classes in played order (dedupe octave doublings).
  var seenPc = {};
  var noteNames = [];
  for (var nn = 0; nn < nums.length; nn++) {
    var pcv = pc(nums[nn]);
    if (!seenPc[pcv]) {
      seenPc[pcv] = 1;
      noteNames.push(NOTE_NAMES[pcv]);
    }
  }
  var bassPc = pc(nums[0]);

  if (pcs.length === 1) {
    var nm = NOTE_NAMES[pcs[0]];
    var semiSet = {};
    for (var si = 0; si < nums.length; si++) semiSet[absSemi(nums[si])] = 1;
    var distinctSemis = 0;
    for (var ss in semiSet) distinctSemis++;
    if (distinctSemis > 1) {
      return { name: nm + ' Octave', notes: [nm] };
    }
    return { name: nm, notes: [nm] };
  }

  // Exact pc-set match; prefer root == bass, then larger pattern.
  var best = null;
  for (var ri = 0; ri < pcs.length; ri++) {
    var root = pcs[ri];
    var ivs = pcs.map(function(x) { return (x - root + 12) % 12; });
    ivs.sort(function(a, b) { return a - b; });

    for (var pi = 0; pi < CHORD_PATTERNS.length; pi++) {
      var pat = CHORD_PATTERNS[pi].i;
      if (!setsEqual(pat, ivs)) continue;

      var priority = (root === bassPc ? 2 : 1);
      if (!best
          || priority > best.priority
          || (priority === best.priority && pat.length > best.pat.length)) {
        best = { root: root, pat: pat, name: CHORD_PATTERNS[pi].n, priority: priority };
      }
    }
  }

  if (best) {
    var label = NOTE_NAMES[best.root] + best.name;
    if (best.root !== bassPc) label += '/' + NOTE_NAMES[bassPc];
    return { name: label, notes: noteNames };
  }

  // Fallback: biggest subset pattern with fewest extras; show as partial.
  var fit = null;
  for (var ri2 = 0; ri2 < pcs.length; ri2++) {
    var root2 = pcs[ri2];
    var ivs2 = pcs.map(function(x) { return (x - root2 + 12) % 12; });

    for (var pi2 = 0; pi2 < CHORD_PATTERNS.length; pi2++) {
      var pat2 = CHORD_PATTERNS[pi2].i;
      if (pat2.length > ivs2.length) continue;
      var ok = true;
      for (var xi = 0; xi < pat2.length; xi++) {
        if (ivs2.indexOf(pat2[xi]) === -1) { ok = false; break; }
      }
      if (!ok) continue;

      var extras = ivs2.length - pat2.length;
      var bassBonus = (root2 === bassPc ? 1 : 0);
      var score = pat2.length * 100 - extras * 10 + bassBonus;
      if (!fit || score > fit.score) {
        fit = { root: root2, name: CHORD_PATTERNS[pi2].n, score: score };
      }
    }
  }

  if (fit) {
    var lbl = NOTE_NAMES[fit.root] + fit.name + '?';
    if (fit.root !== bassPc) lbl += '/' + NOTE_NAMES[bassPc];
    return { name: lbl, notes: noteNames };
  }

  return { name: '?', notes: noteNames };
}

// 5x7 bitmap font for scaled rendering. Each glyph is 7 rows, top to
// bottom; each row's low 5 bits are the pixels, MSB = leftmost pixel.
var FONT_5x7 = {
  'A':[0x0E,0x11,0x11,0x1F,0x11,0x11,0x11],
  'B':[0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
  'C':[0x0E,0x11,0x10,0x10,0x10,0x11,0x0E],
  'D':[0x1E,0x11,0x11,0x11,0x11,0x11,0x1E],
  'E':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F],
  'F':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
  'G':[0x0E,0x11,0x10,0x17,0x11,0x11,0x0E],
  'M':[0x11,0x1B,0x15,0x15,0x11,0x11,0x11],
  'O':[0x0E,0x11,0x11,0x11,0x11,0x11,0x0E],
  'a':[0x00,0x00,0x0E,0x01,0x0F,0x11,0x0F],
  'c':[0x00,0x00,0x0E,0x10,0x10,0x10,0x0E],
  'e':[0x00,0x00,0x0E,0x11,0x1F,0x10,0x0E],
  't':[0x08,0x08,0x1E,0x08,0x08,0x09,0x06],
  'v':[0x00,0x00,0x11,0x11,0x11,0x0A,0x04],
  'b':[0x10,0x10,0x10,0x1E,0x11,0x11,0x1E],
  'd':[0x01,0x01,0x01,0x0F,0x11,0x11,0x0F],
  'g':[0x00,0x0E,0x11,0x11,0x0F,0x01,0x0E],
  'i':[0x04,0x00,0x0C,0x04,0x04,0x04,0x0E],
  'j':[0x02,0x00,0x06,0x02,0x02,0x12,0x0C],
  'm':[0x00,0x00,0x1A,0x15,0x15,0x15,0x15],
  's':[0x00,0x00,0x0E,0x10,0x0E,0x01,0x1E],
  'u':[0x00,0x00,0x11,0x11,0x11,0x11,0x0F],
  '0':[0x0E,0x13,0x15,0x19,0x11,0x11,0x0E],
  '1':[0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
  '2':[0x0E,0x11,0x01,0x02,0x04,0x08,0x1F],
  '3':[0x0E,0x11,0x01,0x06,0x01,0x11,0x0E],
  '4':[0x02,0x06,0x0A,0x12,0x1F,0x02,0x02],
  '5':[0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
  '6':[0x06,0x08,0x10,0x1E,0x11,0x11,0x0E],
  '7':[0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
  '9':[0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
  '#':[0x0A,0x1F,0x0A,0x1F,0x0A,0x00,0x00],
  '/':[0x01,0x02,0x04,0x08,0x10,0x00,0x00],
  '?':[0x0E,0x11,0x01,0x06,0x04,0x00,0x04],
  '-':[0x00,0x00,0x00,0x1F,0x00,0x00,0x00],
  ' ':[0x00,0x00,0x00,0x00,0x00,0x00,0x00]
};

function bigPrint(x, y, text, color, scale) {
  var s = scale || 2;
  for (var i = 0; i < text.length; i++) {
    var glyph = FONT_5x7[text.charAt(i)];
    if (glyph) {
      for (var row = 0; row < 7; row++) {
        var bits = glyph[row];
        for (var col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) {
            fill_rect(x + col * s, y + row * s, s, s, color);
          }
        }
      }
    }
    x += 6 * s; // 5 pixel char + 1 pixel gap, scaled
  }
}

function bigPrintCentered(y, text, color, scale) {
  var s = scale || 2;
  var w = text.length * 6 * s - s;
  var x = Math.max(0, Math.floor((128 - w) / 2));
  bigPrint(x, y, text, color, scale);
}

function draw() {
  clear_screen();

  // Slim header
  fill_rect(0, 0, 128, 9, 1);
  print(2, 1, 'CHORDDEX', 0);

  var chord = getChord();

  if (!chord) {
    bigPrintCentered(22, '---', 1, 2);
    var msg = 'play some pads';
    print(Math.floor((128 - msg.length * 6) / 2), 52, msg, 1);
  } else {
    // Auto-shrink: scale 2x if chord name fits (<=10 chars), else small.
    if (chord.name.length * 12 <= 128) {
      bigPrintCentered(18, chord.name, 1, 2);
    } else {
      // Fallback to normal print, centered.
      var cw = chord.name.length * 6;
      print(Math.max(2, Math.floor((128 - cw) / 2)), 24, chord.name, 1);
    }
    // Notes line, small font, centered; truncate with "..." if overflow.
    var noteStr = chord.notes.join(' ');
    if (noteStr.length * 6 > 124) {
      var maxChars = Math.floor(124 / 6) - 3;
      noteStr = noteStr.substring(0, maxChars) + '...';
    }
    var nw = noteStr.length * 6;
    print(Math.max(2, Math.floor((128 - nw) / 2)), 52, noteStr, 1);
  }

  dirty = false;
}

globalThis.init = function() {
  activeNotes  = {};
  lastVelocity = 0;
  lastRawNote  = -1;
  dirty        = true;
  schedulePaintBase();
  draw();
};

globalThis.tick = function() {
  paintTick();
  if (dirty) draw();
};

globalThis.onMidiMessageInternal = function(msg) {
  if (!msg || msg.length < 2) return;

  var st   = msg[0] & 0xF0;
  var note = msg[1];
  var vel  = msg.length > 2 ? msg[2] : 0;

  // Back button (CC 51) — exit to Tools menu
  if (st === 0xB0 && note === 51 && vel === 127) {
    padsAllOff();
    host_exit_module();
    return;
  }

  // Ignore knob capacitive touch (notes 0-9)
  if (note < 10) return;

  // Only handle pad notes (68-99)
  var isPad = (note >= 68 && note <= 99);

  if (st === 0x90 && vel > 0) {
    if (isPad) {
      activeNotes[note] = vel;
      lastVelocity = vel;
      lastRawNote  = note;
      paintTwins(note, true);
      dirty = true;
    }

  } else if (st === 0x80 || (st === 0x90 && vel === 0)) {
    if (isPad) {
      delete activeNotes[note];
      paintTwins(note, false);
      dirty = true;
    }

  } else if (st === 0xB0 && note === 123) {
    // All notes off
    activeNotes = {};
    schedulePaintBase();
    dirty = true;
  }
};

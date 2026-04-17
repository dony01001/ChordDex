// ChordDex — tool module for Schwung / Ableton Move
// Real-time chord & note recognizer. Lights pads by scale, detects
// played chords (triads, 7ths, 9ths, sus, add, slash), shows name on screen.

var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// All intervals mod 12. Patterns are pitch-class sets, not voicings.
// Order matters only for tie-breaking when multiple patterns match.
var CHORD_PATTERNS = [
  // 5-note (9ths) — checked first so richer chords win
  { i: [0,2,4,7,10], n: '9'    },
  { i: [0,2,4,7,11], n: 'maj9' },
  { i: [0,2,3,7,10], n: 'm9'   },
  // 4-note sixths and sevenths
  { i: [0,4,7,11],   n: 'maj7' },
  { i: [0,4,7,10],   n: '7'    },
  { i: [0,3,7,10],   n: 'm7'   },
  { i: [0,3,7,11],   n: 'mM7'  },
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

// LED colors (velocity byte on internal 0x90). See shared/constants.mjs.
var LED_ROOT    = 126; // Green (vivid) — C (root)
var LED_SCALE   = 118; // LightGrey (dim white) — notes in scale
var LED_OUT     = 0;   // Black — notes outside scale
var LED_PRESSED = 21;  // HotMagenta — pad currently held

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

  var noteNames = nums.map(function(n) { return NOTE_NAMES[pc(n)]; });
  var bassPc = pc(nums[0]);

  if (pcs.length === 1) {
    return { name: NOTE_NAMES[pcs[0]], notes: [NOTE_NAMES[pcs[0]]] };
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

function draw() {
  clear_screen();

  // Header
  fill_rect(0, 0, 128, 11, 1);
  print(3, 2, 'CHORD DETECTOR', 0);

  var chord = getChord();

  if (!chord) {
    print(3, 18, '---', 1);
    print(3, 32, 'play some pads', 1);
  } else {
    print(3, 14, chord.name, 1);
    var noteStr = chord.notes.join(' ');
    print(3, 32, noteStr, 1);
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
      padLed(note, LED_PRESSED);
      dirty = true;
    }

  } else if (st === 0x80 || (st === 0x90 && vel === 0)) {
    if (isPad) {
      delete activeNotes[note];
      padLed(note, baseColor(note));
      dirty = true;
    }

  } else if (st === 0xB0 && note === 123) {
    // All notes off
    activeNotes = {};
    schedulePaintBase();
    dirty = true;
  }
};

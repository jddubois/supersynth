// supersynth in a browser: pick an instrument or an organ, play it live.
import { INSTRUMENTS, ORGANS, Synth } from 'supersynth';

const $ = (id) => document.getElementById(id);
const status = (s) => ($('status').textContent = s);

// the instruments, and a few organs (they download 5–150 MB)
for (const [group, ids] of [['Instruments', Object.keys(INSTRUMENTS)], ['Organs', ['green-positiv', 'harmonium', 'burea', 'friesach']]]) {
  const g = document.createElement('optgroup');
  g.label = group;
  for (const id of ids) g.append(new Option(INSTRUMENTS[id]?.name ?? ORGANS[id]?.name ?? id, id));
  $('instrument').append(g);
}
const presets = () => {
  const id = $('instrument').value;
  $('preset').replaceChildren(...Object.keys((INSTRUMENTS[id] ?? ORGANS[id]).presets).map((p) => new Option(p, p)));
};
$('instrument').onchange = presets;
presets();

let synth;
let playing; // what the keys play: an instrument, or an organ's great
let current;

$('go').onclick = async () => {
  try {
    $('go').disabled = true;
    // a page may start audio only from a user gesture: create and start here
    synth ??= await Synth.create();
    const id = $('instrument').value;
    status(`Downloading ${id}…`);
    await synth.load(id);
    if (current) synth.remove(current);
    current = synth.add(id, { preset: $('preset').value });
    playing = current.great ?? current;
    await synth.start();
    status(`${id} ready`);
  } catch (e) {
    status(String(e.message ?? e));
    console.error(e);
  } finally {
    $('go').disabled = false;
  }
};

setInterval(() => {
  if (synth?.isRunning) status(`${$('instrument').selectedOptions[0].text} · ${synth.threads} threads · ${synth.activeVoices} voices · CPU ${(100 * synth.cpuLoad).toFixed(0)}% of real time`);
}, 250);

// an on-screen keyboard (two octaves from `base`) and the computer keyboard
let base = 60;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const keys = [];
for (let i = 0; i < 25; i++) {
  const k = document.createElement('div');
  if ([1, 3, 6, 8, 10].includes(i % 12)) k.className = 'black';
  k.onpointerdown = () => down(i);
  k.onpointerup = k.onpointerleave = () => up(i);
  $('keys').append(k);
  keys.push(k);
}
const label = () => keys.forEach((k, i) => (k.textContent = NAMES[(base + i) % 12] + Math.floor((base + i) / 12 - 1)));
label();
const held = new Map();
function down(i) {
  if (!playing || held.has(i)) return;
  held.set(i, base + i);
  keys[i].classList.add('down');
  playing.noteOn(base + i, 90);
}
function up(i) {
  if (!held.has(i)) return;
  playing.noteOff(held.get(i));
  held.delete(i);
  keys[i].classList.remove('down');
}
const MAP = 'awsedftgyhujk';
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'z') ((base = Math.max(24, base - 12)), label());
  if (e.key === 'x') ((base = Math.min(96, base + 12)), label());
  const i = MAP.indexOf(e.key);
  if (i >= 0) down(i);
});
addEventListener('keyup', (e) => {
  const i = MAP.indexOf(e.key);
  if (i >= 0) up(i);
});

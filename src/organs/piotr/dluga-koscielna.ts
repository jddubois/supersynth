import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set; models/organ/dluga-koscielna/<id>.ssm.
// Manual I is the great, manual II (unenclosed) the positive.
const STOPS: StopDefinition[] = [
  { id: 'great-pryncypal-8', model: 'organ/dluga-koscielna/great-pryncypal-8', name: "Pryncypał 8'", division: 'great', family: 'principal', transpose: 0, feet: 8, actionNoise: [13, 14] },
  { id: 'great-flet-kryty-8', model: 'organ/dluga-koscielna/great-flet-kryty-8', name: "Flet kryty 8'", division: 'great', family: 'flute', transpose: 0, feet: 8, actionNoise: [3, 4] },
  { id: 'great-viola-di-gamba-8', model: 'organ/dluga-koscielna/great-viola-di-gamba-8', name: "Viola di Gamba 8'", division: 'great', family: 'string', transpose: 0, feet: 8, actionNoise: [15, 16] },
  { id: 'great-oktawa-4', model: 'organ/dluga-koscielna/great-oktawa-4', name: "Oktawa 4'", division: 'great', family: 'principal', transpose: 12, feet: 4, actionNoise: [11, 12] },
  { id: 'great-flet-rurkowy-4', model: 'organ/dluga-koscielna/great-flet-rurkowy-4', name: "Flet rurkowy 4'", division: 'great', family: 'flute', transpose: 12, feet: 4, actionNoise: [5, 6] },
  { id: 'great-oktawa-2', model: 'organ/dluga-koscielna/great-oktawa-2', name: "Oktawa 2'", division: 'great', family: 'principal', transpose: 24, feet: 2, actionNoise: [9, 10] },
  { id: 'great-mixtura-1-1-3', model: 'organ/dluga-koscielna/great-mixtura-1-1-3', name: "Mixtura 1 1/3'", division: 'great', family: 'mixture', transpose: 0, actionNoise: [7, 8] },

  { id: 'positive-flauto-amabile-8', model: 'organ/dluga-koscielna/positive-flauto-amabile-8', name: "Flauto amabile 8'", division: 'positive', family: 'flute', transpose: 0, feet: 8, actionNoise: [27, 28] },
  { id: 'positive-gemshorn-8', model: 'organ/dluga-koscielna/positive-gemshorn-8', name: "Gemshorn 8'", division: 'positive', family: 'principal', transpose: 0, feet: 8, actionNoise: [33, 34] },
  { id: 'positive-flet-otwarty-8', model: 'organ/dluga-koscielna/positive-flet-otwarty-8', name: "Flet otwarty 8'", division: 'positive', family: 'flute', transpose: 0, feet: 8, actionNoise: [31, 32] },
  { id: 'positive-pryncypal-4', model: 'organ/dluga-koscielna/positive-pryncypal-4', name: "Pryncypał 4'", division: 'positive', family: 'principal', transpose: 12, feet: 4, actionNoise: [41, 42] },
  { id: 'positive-flet-kryty-4', model: 'organ/dluga-koscielna/positive-flet-kryty-4', name: "Flet kryty 4'", division: 'positive', family: 'flute', transpose: 12, feet: 4, actionNoise: [29, 30] },
  { id: 'positive-nasard-2-2-3', model: 'organ/dluga-koscielna/positive-nasard-2-2-3', name: "Nasard 2 2/3'", division: 'positive', family: 'mutation', transpose: 19, feet: 2 + 2 / 3, keys: [55, 91], actionNoise: [39, 40] },
  { id: 'positive-szpicflet-2', model: 'organ/dluga-koscielna/positive-szpicflet-2', name: "Szpicflet 2'", division: 'positive', family: 'flute', transpose: 24, feet: 2, actionNoise: [43, 44] },
  { id: 'positive-tercja-1-3-5', model: 'organ/dluga-koscielna/positive-tercja-1-3-5', name: "Tercja 1 3/5'", division: 'positive', family: 'mutation', transpose: 28, feet: 1 + 3 / 5, keys: [60, 91], actionNoise: [45, 46] },
  { id: 'positive-kwinta-1-1-3', model: 'organ/dluga-koscielna/positive-kwinta-1-1-3', name: "Kwinta 1 1/3'", division: 'positive', family: 'mutation', transpose: 31, feet: 1 + 1 / 3, actionNoise: [37, 38] },
  { id: 'positive-krumhorn-8', model: 'organ/dluga-koscielna/positive-krumhorn-8', name: "Krumhorn 8'", division: 'positive', family: 'reed', transpose: 0, feet: 8, actionNoise: [35, 36] },

  { id: 'pedal-subbass-16', model: 'organ/dluga-koscielna/pedal-subbass-16', name: "Subbass 16'", division: 'pedal', family: 'flute', transpose: -12, feet: 16, actionNoise: [25, 26] },
  { id: 'pedal-oktawbas-8', model: 'organ/dluga-koscielna/pedal-oktawbas-8', name: "Oktawbas 8'", division: 'pedal', family: 'principal', transpose: 0, feet: 8, actionNoise: [23, 24] },
  { id: 'pedal-flet-kryty-8', model: 'organ/dluga-koscielna/pedal-flet-kryty-8', name: "Flet kryty 8'", division: 'pedal', family: 'flute', transpose: 0, feet: 8, actionNoise: [21, 22] },
  { id: 'pedal-choralbas-4', model: 'organ/dluga-koscielna/pedal-choralbas-4', name: "Chorałbas 4'", division: 'pedal', family: 'principal', transpose: 12, feet: 4, actionNoise: [17, 18] },
  { id: 'pedal-fagot-16', model: 'organ/dluga-koscielna/pedal-fagot-16', name: "Fagot 16'", division: 'pedal', family: 'reed', transpose: -12, feet: 16, actionNoise: [19, 20] },
];

const PRESETS: Record<string, OrganPreset> = {
  principal: {
    description: "Pryncypał 8' alone",
    great: ["Pryncypał 8'"],
    pedal: ["Subbass 16'", "Oktawbas 8'"],
  },
  'principal-chorus': {
    description: "Principal chorus 8' 4' 2' on manual I",
    great: ["Pryncypał 8'", "Oktawa 4'", "Oktawa 2'"],
    pedal: ["Subbass 16'", "Oktawbas 8'", "Chorałbas 4'"],
    couple: { pedal: ['great'] },
  },
  plenum: {
    description: 'Plenum: principals and Mixtura with manual II coupled',
    great: ["Pryncypał 8'", "Flet kryty 8'", "Oktawa 4'", "Oktawa 2'", "Mixtura 1 1/3'"],
    positive: ["Gemshorn 8'", "Pryncypał 4'", "Szpicflet 2'", "Kwinta 1 1/3'"],
    pedal: ["Subbass 16'", "Oktawbas 8'", "Chorałbas 4'", "Fagot 16'"],
    couple: { great: ['positive'], pedal: ['great'] },
  },
  full: {
    description: 'Full organ with Krumhorn and Fagot',
    great: ["Pryncypał 8'", "Flet kryty 8'", "Viola di Gamba 8'", "Oktawa 4'", "Flet rurkowy 4'", "Oktawa 2'", "Mixtura 1 1/3'"],
    positive: ["Gemshorn 8'", "Flet otwarty 8'", "Pryncypał 4'", "Flet kryty 4'", "Nasard 2 2/3'", "Szpicflet 2'", "Tercja 1 3/5'",
      "Kwinta 1 1/3'", "Krumhorn 8'"],
    pedal: ["Subbass 16'", "Oktawbas 8'", "Flet kryty 8'", "Chorałbas 4'", "Fagot 16'"],
    couple: { great: ['positive'], pedal: ['great', 'positive'] },
  },
  foundations: {
    description: "The 8' stops of both manuals coupled",
    great: ["Pryncypał 8'", "Flet kryty 8'", "Viola di Gamba 8'"],
    positive: ["Gemshorn 8'", "Flet otwarty 8'", "Flauto amabile 8'"],
    pedal: ["Subbass 16'", "Oktawbas 8'", "Flet kryty 8'"],
    couple: { great: ['positive'] },
  },
  flutes: {
    description: "Flet kryty 8' + Flet rurkowy 4' on manual I",
    great: ["Flet kryty 8'", "Flet rurkowy 4'"],
    pedal: ["Subbass 16'", "Flet kryty 8'"],
  },
  'flute-8': {
    description: "Flauto amabile 8', the softest flute",
    positive: ["Flauto amabile 8'"],
    pedal: ["Subbass 16'"],
  },
  cornet: {
    description: "Cornet from manual II's flutes and mutations (8' 4' 2 2/3' 2' 1 3/5') against manual I",
    positive: ["Flet otwarty 8'", "Flet kryty 4'", "Nasard 2 2/3'", "Szpicflet 2'", "Tercja 1 3/5'"],
    great: ["Flet kryty 8'", "Flet rurkowy 4'"],
    pedal: ["Subbass 16'", "Flet kryty 8'"],
  },
  nasard: {
    description: "Flet otwarty 8', Flet kryty 4' and Nasard 2 2/3'",
    positive: ["Flet otwarty 8'", "Flet kryty 4'", "Nasard 2 2/3'"],
    great: ["Flet kryty 8'"],
    pedal: ["Subbass 16'"],
  },
  gamba: {
    description: "Viola di Gamba 8' with the Flet kryty",
    great: ["Viola di Gamba 8'", "Flet kryty 8'"],
    pedal: ["Subbass 16'"],
  },
  krumhorn: {
    description: "Krumhorn 8' solo on manual II against manual I's flutes",
    positive: ["Flauto amabile 8'", "Krumhorn 8'"],
    great: ["Flet kryty 8'"],
    pedal: ["Subbass 16'", "Flet kryty 8'"],
  },
};

/** Długa Kościelna (Kamiński, 2012, Poland): 22 stops on two manuals and pedal, from Piotr
 *  Grabowski's free sample set. */
export const DLUGA_KOSCIELNA_ORGAN: OrganDefinition = {
  id: 'dluga-koscielna',
  name: 'Długa Kościelna',
  description: 'Kamiński 2012, Długa Kościelna (Poland): 22 stops on two manuals and pedal, a principal chorus with Mixtura on the great and a flute-and-mutation positive with Krumhorn.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'principal-chorus',
  divisions: { great: { pan: 0 }, swell: { pan: 0.15 }, positive: { pan: -0.15 }, pedal: { pan: 0 } },
  tremulant: { division: 'positive', name: 'Tremulant 2 Man', depth: 0.98, pitch: 7.2, rate: 4.74, actionNoise: [47, 48] },
  wind: 0,
  noises: { keys: { pedal: { down: 'organ/dluga-koscielna/noise-keys-pedal-down', up: 'organ/dluga-koscielna/noise-keys-pedal-up' }, great: { down: 'organ/dluga-koscielna/noise-keys-great-down', up: 'organ/dluga-koscielna/noise-keys-great-up' }, positive: { down: 'organ/dluga-koscielna/noise-keys-positive-down', up: 'organ/dluga-koscielna/noise-keys-positive-up' } }, stops: 'organ/dluga-koscielna/noise-stops', blower: { model: 'organ/dluga-koscielna/noise-blower' }, ambient: { model: 'organ/dluga-koscielna/noise-ambient' }, coupler: [49, 50] },
};

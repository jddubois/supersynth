import type { OrganDefinition, OrganPreset, StopDefinition } from '../types.js';

// Every pipe analysed from Piotr Grabowski's free sample set (the Hauptwerk package with his
// GrandOrgue definition); models/organ/saint-jean-de-luz/<id>.ssm. Each stop sums the three
// microphone perspectives of the set (front, rear, dry) as the definition mixes them. Both the
// Grand Orgue and the Récit stand in swell boxes.
const STOPS: StopDefinition[] = [
  { id: 'great-bourdon-16', model: 'organ/saint-jean-de-luz/great-bourdon-16', name: "Bourdon 16'", division: 'great', family: 'flute', transpose: -12 },
  { id: 'great-flute-harmonique-8', model: 'organ/saint-jean-de-luz/great-flute-harmonique-8', name: "Flûte harmonique 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-bourdon-8', model: 'organ/saint-jean-de-luz/great-bourdon-8', name: "Bourdon 8'", division: 'great', family: 'flute', transpose: 0 },
  { id: 'great-prestant-4', model: 'organ/saint-jean-de-luz/great-prestant-4', name: "Prestant 4'", division: 'great', family: 'principal', transpose: 12 },
  { id: 'great-quinte-2-2-3', model: 'organ/saint-jean-de-luz/great-quinte-2-2-3', name: "Quinte 2 2/3'", division: 'great', family: 'mutation', transpose: 19 },
  { id: 'great-doublette-2', model: 'organ/saint-jean-de-luz/great-doublette-2', name: "Doublette 2'", division: 'great', family: 'principal', transpose: 24 },
  { id: 'great-tierce-1-3-5', model: 'organ/saint-jean-de-luz/great-tierce-1-3-5', name: "Tierce 1 3/5'", division: 'great', family: 'mutation', transpose: 28 },

  { id: 'swell-flute-8', model: 'organ/saint-jean-de-luz/swell-flute-8', name: "Flûte 8'", division: 'swell', family: 'flute', transpose: 0 },
  { id: 'swell-flute-4', model: 'organ/saint-jean-de-luz/swell-flute-4', name: "Flûte 4'", division: 'swell', family: 'flute', transpose: 12 },
  { id: 'swell-plein-jeu-iii', model: 'organ/saint-jean-de-luz/swell-plein-jeu-iii', name: "Plein-jeu III", division: 'swell', family: 'mixture', transpose: 0, keys: [36, 91] },
  { id: 'swell-trompette-8', model: 'organ/saint-jean-de-luz/swell-trompette-8', name: "Trompette 8'", division: 'swell', family: 'reed', transpose: 0 },

  { id: 'pedal-soubasse-16', model: 'organ/saint-jean-de-luz/pedal-soubasse-16', name: "Soubasse 16'", division: 'pedal', family: 'flute', transpose: -12 },
  { id: 'pedal-bourdon-8', model: 'organ/saint-jean-de-luz/pedal-bourdon-8', name: "Bourdon 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-flute-8', model: 'organ/saint-jean-de-luz/pedal-flute-8', name: "Flûte 8'", division: 'pedal', family: 'flute', transpose: 0 },
  { id: 'pedal-flute-4', model: 'organ/saint-jean-de-luz/pedal-flute-4', name: "Flûte 4'", division: 'pedal', family: 'flute', transpose: 12 },
  { id: 'pedal-flute-2', model: 'organ/saint-jean-de-luz/pedal-flute-2', name: "Flûte 2'", division: 'pedal', family: 'flute', transpose: 24 },
];

const PRESETS: Record<string, OrganPreset> = {
  fonds: {
    description: "Fonds de 8': Flûte harmonique and Bourdon with the Récit Flûte coupled",
    great: ["Flûte harmonique 8'", "Bourdon 8'"],
    swell: ["Flûte 8'"],
    pedal: ["Soubasse 16'", "Bourdon 8'"],
    couple: { great: ['swell'] },
  },
  'jeux-doux': {
    description: "Bourdon 8', the softest registration, for accompanying",
    great: ["Bourdon 8'"],
    pedal: ["Soubasse 16'"],
  },
  'fonds-8-4': {
    description: "Fonds 8' and 4' on both manuals",
    great: ["Flûte harmonique 8'", "Bourdon 8'", "Prestant 4'"],
    swell: ["Flûte 8'", "Flûte 4'"],
    pedal: ["Soubasse 16'", "Bourdon 8'", "Flûte 4'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  'plein-jeu': {
    description: 'Plein jeu: the Grand Orgue chorus with the Récit Plein-jeu coupled',
    great: ["Bourdon 16'", "Flûte harmonique 8'", "Bourdon 8'", "Prestant 4'", "Doublette 2'"],
    swell: ["Flûte 8'", "Flûte 4'", 'Plein-jeu III'],
    pedal: ["Soubasse 16'", "Bourdon 8'", "Flûte 4'", "Flûte 2'"],
    couple: { great: ['swell'], pedal: ['great'] },
  },
  'grand-choeur': {
    description: 'Grand chœur: every stop, the Récit coupled',
    great: ["Bourdon 16'", "Flûte harmonique 8'", "Bourdon 8'", "Prestant 4'", "Quinte 2 2/3'", "Doublette 2'", "Tierce 1 3/5'"],
    swell: ["Flûte 8'", "Flûte 4'", 'Plein-jeu III', "Trompette 8'"],
    pedal: ["Soubasse 16'", "Bourdon 8'", "Flûte 8'", "Flûte 4'", "Flûte 2'"],
    couple: { great: ['swell'], pedal: ['great', 'swell'] },
  },
  'grand-choeur-octaves': {
    description: "Grand chœur with the Récit coupled at 16', 8' and 4' to the Grand Orgue and in octaves on itself, the full romantic sound",
    great: ["Bourdon 16'", "Flûte harmonique 8'", "Bourdon 8'", "Prestant 4'", "Quinte 2 2/3'", "Doublette 2'", "Tierce 1 3/5'"],
    swell: ["Flûte 8'", "Flûte 4'", 'Plein-jeu III', "Trompette 8'"],
    pedal: ["Soubasse 16'", "Bourdon 8'", "Flûte 8'", "Flûte 4'", "Flûte 2'"],
    couple: {
      great: ['swell', { division: 'swell', octave: -1 }, { division: 'swell', octave: 1 }],
      swell: [{ division: 'swell', octave: -1 }, { division: 'swell', octave: 1 }],
      pedal: ['great', 'swell'],
    },
  },
  'recit-annulation': {
    description: "The Récit (Flûte 8' + Trompette 8') played from the Grand Orgue alone, with its 4' coupler: Annulation GO",
    great: ["Bourdon 8'"],
    swell: ["Flûte 8'", "Trompette 8'"],
    pedal: ["Soubasse 16'"],
    couple: { great: ['swell', { division: 'swell', octave: 1 }] },
    unisonOff: ['great'],
  },
  cornet: {
    description: "Cornet décomposé on the Grand Orgue (8' 4' 2 2/3' 2' 1 3/5') against the Récit flutes",
    great: ["Bourdon 8'", "Prestant 4'", "Quinte 2 2/3'", "Doublette 2'", "Tierce 1 3/5'"],
    swell: ["Flûte 8'"],
    pedal: ["Soubasse 16'", "Bourdon 8'"],
  },
  nazard: {
    description: "Bourdon 8' with Quinte 2 2/3', a gentle solo against the Récit",
    great: ["Bourdon 8'", "Quinte 2 2/3'"],
    swell: ["Flûte 8'"],
    pedal: ["Soubasse 16'"],
  },
  'flute-harmonique': {
    description: "Flûte harmonique 8' solo against the Récit Flûte",
    great: ["Flûte harmonique 8'"],
    swell: ["Flûte 8'"],
    pedal: ["Soubasse 16'"],
  },
  trompette: {
    description: "Trompette 8' solo on the Récit against the Grand Orgue fonds",
    swell: ["Flûte 8'", "Trompette 8'"],
    great: ["Flûte harmonique 8'", "Bourdon 8'"],
    pedal: ["Soubasse 16'", "Bourdon 8'"],
  },
};

/** Saint-Jean-de-Luz, choir organ (Victor Gonzalez, 1931, France): 16 stops on two enclosed
 *  manuals and pedal, from Piotr Grabowski's free sample set. */
export const SAINT_JEAN_DE_LUZ_ORGAN: OrganDefinition = {
  id: 'saint-jean-de-luz',
  name: 'Saint-Jean-de-Luz (chœur)',
  description: 'Victor Gonzalez 1931, choir organ of Saint-Jean-Baptiste, Saint-Jean-de-Luz (France): 16 stops on two manuals (both enclosed) and pedal.',
  stops: STOPS,
  presets: PRESETS,
  defaultPreset: 'fonds',
  divisions: { great: { pan: -0.1, swellBox: { closed: -8 } }, swell: { pan: 0.1, swellBox: { closed: -8 } }, positive: { pan: 0 }, pedal: { pan: 0 } },
  tremulant: { division: 'great', name: 'Tremulant 2 Division', depth: 1.55, pitch: 8.7, rate: 2.93 },
  wind: 0,
  noises: { ambient: { model: 'organ/saint-jean-de-luz/noise-ambient' } },
};

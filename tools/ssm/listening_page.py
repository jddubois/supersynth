"""Collect audio for the listening page: blind A/B pairs, instrument demos, organ registrations.

  python listening_page.py <out-dir> <blind-dir> <blind-key.json> <demos-dir> [holdout_summary.json] [blind-score.json]

Writes <out-dir>/audio/*.mp3 and <out-dir>/data.js (window.LISTEN = {...}).
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def mp3(src, dst, mono=False, kbps=128):
    if os.path.exists(dst):
        return
    cmd = ['lame', '--silent', '-b', str(kbps)]
    if mono:
        cmd += ['-m', 'm']
    subprocess.run(cmd + [src, dst], check=True)


def main(out, blind_dir, key_path, demos, holdout=None, score=None):
    from catalog_export import catalog
    audio = os.path.join(out, 'audio')
    os.makedirs(audio, exist_ok=True)
    key = json.load(open(key_path))
    pairs = []
    for k in key:
        p = k['pair']
        for w in 'AB':
            mp3(os.path.join(blind_dir, 'pairs', f'{p}_{w}.wav'), os.path.join(audio, f'{p}_{w}.mp3'), mono=True, kbps=96)
        pairs.append({'id': p, 'real': k['real'], 'instrument': k['instrument'], 'note': k['note']})
    cat = catalog()
    insts = []
    for inst in cat['instruments']:
        files = []
        for preset, desc in inst['presets'].items():
            src = os.path.join(demos, inst['id'], f'{preset}.wav')
            if os.path.exists(src):
                name = f"demo_{inst['id']}_{preset}.mp3"
                mp3(src, os.path.join(audio, name))
                files.append({'preset': preset, 'description': desc, 'file': f'audio/{name}'})
        if files:
            insts.append({**inst, 'demos': files})
    organ = []
    for reg, desc in cat['organPresets'].items():
        src = os.path.join(demos, 'organ', f'{reg}.wav')
        if os.path.exists(src):
            name = f'organ_{reg}.mp3'
            mp3(src, os.path.join(audio, name))
            organ.append({'registration': reg, 'description': desc, 'file': f'audio/{name}'})
    examples = []
    for e in ['tour', 'piano', 'organ', 'orchestra']:
        src = os.path.join(demos, f'example-{e}.wav')
        if os.path.exists(src):
            mp3(src, os.path.join(audio, f'example_{e}.mp3'))
            examples.append({'id': e, 'file': f'audio/example_{e}.mp3'})
    data = {'pairs': pairs, 'instruments': insts, 'organ': organ, 'examples': examples,
            'holdout': json.load(open(holdout)) if holdout and os.path.exists(holdout) else {},
            'score': json.load(open(score)) if score and os.path.exists(score) else {}}
    with open(os.path.join(out, 'data.js'), 'w') as f:
        f.write('window.LISTEN = ' + json.dumps(data) + ';\n')
    print(len(pairs), 'pairs,', len(insts), 'instruments,', len(organ), 'registrations,', len(examples), 'examples')


if __name__ == '__main__':
    main(*sys.argv[1:])

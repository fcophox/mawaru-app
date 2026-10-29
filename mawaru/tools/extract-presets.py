#!/usr/bin/env python3
"""Extract the camera presets bundled with your Rotato.app into local-models/presets.json.

For personal, local use only (git-ignored). Each Resources/*.keyframes file is an
NSKeyedArchiver plist with Rotato.Keyframe objects: rigTransform (orbit pivot rotation),
position (camera offset inside the rig), duration and a CAMediaTimingFunction easing.

  python3 tools/extract-presets.py [--app /Applications/Rotato.app] [--out local-models/presets.json]
"""
import argparse, glob, json, os, plistlib, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(path):
    d = plistlib.load(open(path, 'rb')); o = d['$objects']

    def r(x):
        if isinstance(x, plistlib.UID): x = o[x.data]
        if isinstance(x, dict):
            cls = o[x['$class'].data]['$classname'] if '$class' in x else None
            if cls in ('NSArray', 'NSMutableArray'): return [r(i) for i in x['NS.objects']]
            if cls in ('NSImage', 'NSBitmapImageRep', 'NSColor'): return None
            if cls == 'NSValue': return [float(n) for n in re.findall(r'-?[\d.e-]+', r(x['NS.rectval']))]
            return {k: r(v) for k, v in x.items() if k != '$class'}
        return x

    out = []
    for k in r(d['$top']['root']):
        e = (k.get('easingV2') or k.get('easing') or {}).get('function') or {'c1x': .25, 'c1y': .1, 'c2x': .25, 'c2y': 1}
        out.append({'rig': k['rigTransform'], 'pos': k['position'][:3], 'dur': k['duration'],
                    'ease': [round(e[c], 4) for c in ('c1x', 'c1y', 'c2x', 'c2y')], 'jump': bool(k.get('isJumpcut'))})
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--app', default='/Applications/Rotato.app')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'local-models', 'presets.json'))
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.app, 'Contents', 'Resources', '*.keyframes')))
    if not files:
        raise SystemExit(f'No hay .keyframes en {a.app}/Contents/Resources')
    presets = {}
    for f in files:
        try: presets[os.path.basename(f)[:-len('.keyframes')]] = load(f)
        except Exception as e: print('✗', os.path.basename(f), e)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(presets, open(a.out, 'w'), indent=1)
    print(f'{len(presets)} presets → {os.path.abspath(a.out)}')


if __name__ == '__main__':
    main()

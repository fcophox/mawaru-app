#!/usr/bin/env python3
"""Convert Rotato device scenes (.rotato) you have downloaded into glTF binaries (.glb).

For personal, local use only: the models belong to Rotato / their authors. Output goes to
mawaru/local-models/, which is git-ignored. Nothing here is published or bundled.

A .rotato file is an LZFSE-compressed NSKeyedArchiver plist holding an SCNScene plus Rotato's
own metadata (keyframes, labels, DeviceSceneMetadata). This tool walks the SceneKit node tree
and writes the meshes, transforms and PBR materials (with their embedded PNG textures) to GLB.

  python3 tools/rotato2glb.py                     # every scene in ~/Library/Application Support/Rotato/Scenes
  python3 tools/rotato2glb.py "iPhone 15 Pro"     # only scenes whose name contains this text
  python3 tools/rotato2glb.py --src DIR --out DIR

Requires macOS (uses /usr/bin/compression_tool for LZFSE). Standard library only.
"""
import argparse, hashlib, json, math, os, plistlib, re, struct, subprocess, sys, tempfile, zlib

DEFAULT_SRC = os.path.expanduser('~/Library/Application Support/Rotato/Scenes')
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'local-models')

# Rotato UI helpers that are not part of the device
SKIP_NAMES = re.compile(r'^(rotatoTag|Shadow|sceneLabel.*|artboardPlaceholder|Artboard Placeholder|Blocker|internal_blocker)$')
SCREEN_RE = re.compile(r'(\d{3,4})x(\d{3,4})')

FLOAT, U8, U16, U32 = 5126, 5121, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


# ---------------------------------------------------------------- archive access
class Archive:
    def __init__(self, path):
        with tempfile.TemporaryDirectory() as tmp:
            raw = os.path.join(tmp, 'scene.plist')
            r = subprocess.run(['compression_tool', '-decode', '-a', 'lzfse', '-i', path, '-o', raw], capture_output=True)
            if r.returncode:
                raise ValueError('no se pudo descomprimir (¿descarga incompleta?)')
            with open(raw, 'rb') as f:
                data = plistlib.load(f)
        self.o = data['$objects']

    def get(self, v):
        """Resolve UIDs and unwrap NSData / NSString wrappers."""
        if isinstance(v, plistlib.UID):
            v = self.o[v.data]
        if isinstance(v, str) and v == '$null':
            return None
        if isinstance(v, dict) and 'NS.data' in v and len(v) <= 2:
            return self.get(v['NS.data'])
        if isinstance(v, dict) and 'NS.string' in v:
            return self.get(v['NS.string'])
        return v

    def cls(self, x):
        x = self.get(x)
        return self.o[x['$class'].data]['$classname'] if isinstance(x, dict) and '$class' in x else None

    def field(self, obj, key, default=None):
        return self.get(obj[key]) if key in obj else default

    def array(self, obj, key):
        a = self.field(obj, key)
        if a is None:
            return []
        if isinstance(a, dict) and 'NS.objects' in a:
            return [self.get(x) for x in a['NS.objects']]
        return a

    def dictionary(self, d):
        d = self.get(d)
        if not isinstance(d, dict) or 'NS.keys' not in d:
            return {}
        return {self.get(k): self.get(v) for k, v in zip(d['NS.keys'], d['NS.objects'])}

    def find(self, classname):
        return [x for x in self.o if self.cls(x) == classname]


# ---------------------------------------------------------------- math
def floats(b, n):
    return list(struct.unpack(f'<{n}f', b[:4 * n])) if isinstance(b, (bytes, bytearray)) and len(b) >= 4 * n else None

def quat_axis_angle(x, y, z, a):
    l = math.sqrt(x * x + y * y + z * z) or 1.0
    s = math.sin(a / 2)
    return [x / l * s, y / l * s, z / l * s, math.cos(a / 2)]

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# ---------------------------------------------------------------- minimal PNG codec
# glTF has no separate opacity map: SceneKit's `transparent` map is merged into the base colour's alpha.
def png_decode(data):
    """→ (width, height, RGBA bytearray). 8/16-bit, non-interlaced, all colour types."""
    pos, chunks, idat = 8, {}, bytearray()
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IDAT': idat += body
        else: chunks.setdefault(kind, body)
        pos += 12 + n
    w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', chunks[b'IHDR'])
    if interlace: raise ValueError('PNG entrelazado')
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = max(1, ch * depth // 8)
    stride = (w * ch * depth + 7) // 8
    raw = zlib.decompress(bytes(idat))
    out, prev = bytearray(), bytearray(stride)
    for y in range(h):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride): line[i] = (line[i] + ((line[i - bpp] if i >= bpp else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0; b = prev[i]; c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out += line; prev = line
    if depth == 16:
        out = out[0::2]
    elif depth < 8:
        bits, vals = depth, bytearray()
        for y in range(h):
            row = out[y * stride:(y + 1) * stride]
            for x in range(w):
                byte = row[x * bits // 8]; shift = 8 - bits - (x * bits) % 8
                v = (byte >> shift) & ((1 << bits) - 1)
                vals.append(v if ctype == 3 else v * 255 // ((1 << bits) - 1))
        out = vals
    rgba = bytearray(w * h * 4)
    if ctype == 6: rgba[:] = out
    elif ctype == 2:
        rgba[0::4], rgba[1::4], rgba[2::4] = out[0::3], out[1::3], out[2::3]; rgba[3::4] = b'\xff' * (w * h)
    elif ctype == 0:
        rgba[0::4] = rgba[1::4] = rgba[2::4] = out; rgba[3::4] = b'\xff' * (w * h)
    elif ctype == 4:
        rgba[0::4] = rgba[1::4] = rgba[2::4] = out[0::2]; rgba[3::4] = out[1::2]
    else:
        pal, trns = chunks[b'PLTE'], chunks.get(b'tRNS', b'')
        for i, v in enumerate(out):
            rgba[i * 4:i * 4 + 3] = pal[v * 3:v * 3 + 3]; rgba[i * 4 + 3] = trns[v] if v < len(trns) else 255
    return w, h, rgba

def png_encode(w, h, rgba):
    rows = b''.join(b'\0' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    chunk = lambda k, d: struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b'')

_merge_cache = {}
def merge_opacity(color_png, color_rgba, opacity_png, mode):
    """RGB from the diffuse map (or a flat colour), A from SceneKit's transparent map."""
    key = (hashlib.sha1(color_png or b'').hexdigest(), tuple(color_rgba or ()), hashlib.sha1(opacity_png).hexdigest(), mode)
    if key in _merge_cache:
        return _merge_cache[key]
    tw, th, t = png_decode(opacity_png)
    if color_png:
        w, h, out = png_decode(color_png)
    else:
        w, h = tw, th
        r, g, b = (int(round(v * 255)) for v in (color_rgba or [1, 1, 1])[:3])
        out = bytearray(bytes((r, g, b, 255)) * (w * h))
    if (tw, th) != (w, h):                                   # nearest-neighbour resample of the mask
        t2 = bytearray(w * h * 4)
        for y in range(h):
            sy = y * th // h
            for x in range(w):
                si, di = (sy * tw + x * tw // w) * 4, (y * w + x) * 4
                t2[di:di + 4] = t[si:si + 4]
        t = t2
    if mode == 1:                                            # rgbZero: opacity = 1 - luminance
        out[3::4] = bytes(255 - (t[i] * 54 + t[i + 1] * 183 + t[i + 2] * 19) // 256 for i in range(0, len(t), 4))
    else:                                                    # aOne (default): opacity = alpha
        out[3::4] = t[3::4]
    res = png_encode(w, h, out)
    _merge_cache[key] = res
    return res


# ---------------------------------------------------------------- glTF writer
class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.j = {'asset': {'version': '2.0', 'generator': 'rotato2glb (local, personal use)'},
                  'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [], 'materials': [],
                  'accessors': [], 'bufferViews': [], 'buffers': [], 'images': [], 'textures': [], 'samplers': []}
        self.image_ids = {}
        self.used_unlit = False

    def view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, data, ctype, count, atype, target, minmax=None):
        a = {'bufferView': self.view(data, target), 'componentType': ctype, 'count': count, 'type': atype}
        if minmax:
            a['min'], a['max'] = minmax
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def image(self, png):
        h = hashlib.sha1(png).hexdigest()
        if h not in self.image_ids:
            if not self.j['samplers']:
                self.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
            self.j['images'].append({'bufferView': self.view(png), 'mimeType': 'image/png'})
            self.j['textures'].append({'source': len(self.j['images']) - 1, 'sampler': 0})
            self.image_ids[h] = len(self.j['textures']) - 1
        return self.image_ids[h]

    def glb(self):
        j = {k: v for k, v in self.j.items() if v != []}
        if self.used_unlit:
            j['extensionsUsed'] = ['KHR_materials_unlit']
        j['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        b = bytes(self.bin) + b'\0' * (-len(self.bin) % 4)
        total = 12 + 8 + len(js) + 8 + len(b)
        return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js
                + struct.pack('<II', len(b), 0x004E4942) + b)


# ---------------------------------------------------------------- converter
class Converter:
    def __init__(self, ar):
        self.ar = ar
        self.g = Gltf()
        self.materials = {}       # id(SCNMaterial) -> glTF index
        self.meshes = {}          # id(SCNGeometry) -> glTF index
        self.screens, self.colorable, self.warnings = [], set(), []

    # ---- materials
    def color_of(self, c):
        c = self.ar.get(c)
        if not isinstance(c, dict):
            return None
        comp = self.ar.field(c, 'NSComponents') or self.ar.field(c, 'NSRGB') or self.ar.field(c, 'NSWhite')
        if not isinstance(comp, (bytes, bytearray)):
            return None
        vals = [float(v) for v in comp.rstrip(b'\0').split()]
        if len(vals) <= 2:                         # grey [+ alpha]
            vals = [vals[0]] * 3 + vals[1:]
        return (vals + [1.0])[:4]

    def prop(self, mat, key):
        """(color rgba | None, float | None, png bytes | None, uv channel) of an SCNMaterialProperty."""
        p = self.ar.field(mat, key)
        if not isinstance(p, dict):
            return None, None, None, 0
        png = None
        img = self.ar.field(p, 'image')
        if img is not None:
            d = self.ar.dictionary(img)
            data = d.get('data')
            if isinstance(data, (bytes, bytearray)) and data[:4] == b'\x89PNG':
                png = bytes(data)
        color = self.color_of(p['color']) if 'color' in p else None
        f = self.ar.field(p, 'float')
        intensity = self.ar.field(p, 'intensity', 1.0)
        if color and intensity not in (None, 1.0):
            color = [c * intensity for c in color[:3]] + color[3:]
        return color, f, png, self.ar.field(p, 'mappingChannel', 0) or 0

    def material(self, mat):
        key = id(mat)
        if key in self.materials:
            return self.materials[key]
        ar, name = self.ar, self.ar.field(mat, 'name') or 'material'
        m = {'name': name, 'pbrMetallicRoughness': {}}
        pbr = m['pbrMetallicRoughness']
        dc, _, dpng, dch = self.prop(mat, 'diffuse')
        tc, _, tpng, _ = self.prop(mat, 'transparent')
        base = [srgb_to_linear(c) for c in (dc or [1, 1, 1])[:3]] + [(dc or [1, 1, 1, 1])[3]]
        if tpng:
            try:
                dpng = merge_opacity(dpng, None if dpng else dc, tpng, ar.field(mat, 'transparencyMode', 0) or 0)
                if not (dc and dpng):
                    base[:3] = [1.0, 1.0, 1.0]                # the flat colour now lives in the texture
            except Exception as e:
                self.warnings.append(f'mapa de transparencia no combinado ({e})')
        if dpng:
            pbr['baseColorTexture'] = {'index': self.g.image(dpng), 'texCoord': dch}
        mc, mf, mpng, _ = self.prop(mat, 'metalness')
        rc, rf, rpng, _ = self.prop(mat, 'roughness')
        metal = mf if mf is not None else (sum(mc[:3]) / 3 if mc else (0.5 if mpng else 0.0))
        rough = rf if rf is not None else (sum(rc[:3]) / 3 if rc else (0.5 if rpng else 0.5))
        model = ar.field(mat, 'lightingModelName') or ''
        if 'PhysicallyBase' not in model:            # Blinn/Phong/Lambert → dielectric approximation
            metal, rough = 0.0, 0.45
        pbr['metallicFactor'], pbr['roughnessFactor'] = round(min(max(metal, 0), 1), 4), round(min(max(rough, 0.02), 1), 4)
        _, _, npng, nch = self.prop(mat, 'normal')
        if npng:
            m['normalTexture'] = {'index': self.g.image(npng), 'texCoord': nch}
        ec, _, epng, ech = self.prop(mat, 'emission')
        if epng:
            m['emissiveTexture'] = {'index': self.g.image(epng), 'texCoord': ech}
            m['emissiveFactor'] = [1, 1, 1]
        elif ec and max(ec[:3]) > 0.001:
            m['emissiveFactor'] = [round(srgb_to_linear(c), 4) for c in ec[:3]]
        # transparency: SceneKit 'transparency' 1 = opaque; a 'transparent' map or alpha color makes it blended
        alpha = ar.field(mat, 'transparency', 1.0) * base[3]
        if tc and len(tc) > 3 and not tpng:
            alpha *= tc[3]
        blend = ar.field(mat, 'blendMode', 0) or 0
        if blend == 1:
            # SCNBlendModeAdd (screen glass): black base, only reflections add light. glTF can't
            # express additive blending: approximate with a faint layer and flag it for our viewer.
            m['extras'] = {'rotato': {'blendMode': 'add'}}
            alpha = min(alpha, 0.12)
        if alpha < 0.999 or tpng or blend == 1:
            m['alphaMode'] = 'BLEND'
        base[3] = round(alpha, 4)
        pbr['baseColorFactor'] = [round(c, 4) for c in base]
        if ar.field(mat, 'doubleSided'):
            m['doubleSided'] = True
        if 'Constant' in model:
            m['extensions'] = {'KHR_materials_unlit': {}}
            self.g.used_unlit = True
        if 'colorable' in name.lower():
            self.colorable.add(name)
        self.g.j['materials'].append(m)
        self.materials[key] = len(self.g.j['materials']) - 1
        return self.materials[key]

    # ---- geometry
    def source_values(self, s):
        ar = self.ar
        data = ar.field(s, 'data')
        n, comps = ar.field(s, 'vectorCount'), ar.field(s, 'componentsPerVector')
        bpc, off, stride = ar.field(s, 'bytesPerComponent'), ar.field(s, 'dataOffset', 0), ar.field(s, 'dataStride') or 0
        isf = ar.field(s, 'floatComponents')
        stride = stride or bpc * comps
        fmt = {(True, 4): 'f', (True, 8): 'd', (False, 1): 'B', (False, 2): 'H', (False, 4): 'I'}[(bool(isf), bpc)]
        out = []
        for i in range(n):
            base = off + i * stride
            out.append(struct.unpack_from(f'<{comps}{fmt}', data, base))
        return out, comps

    def element_triangles(self, e, channels):
        """→ list of corners; each corner is a tuple of indices (one per channel)."""
        ar = self.ar
        data, bpi = ar.field(e, 'elementData'), ar.field(e, 'bytesPerIndex')
        ptype, count = ar.field(e, 'primitiveType'), ar.field(e, 'primitiveCount')
        fmt = {1: 'B', 2: 'H', 4: 'I'}[bpi]
        idx = struct.unpack(f'<{len(data) // bpi}{fmt}', data)
        corners, tris = [], []
        if ptype == 4:                                   # polygons: counts first, then indices
            sizes, pos = idx[:count], count
            for size in sizes:
                poly = [tuple(idx[pos + k * channels: pos + k * channels + channels]) for k in range(size)]
                pos += size * channels
                for k in range(1, size - 1):              # fan
                    tris += [poly[0], poly[k], poly[k + 1]]
            return tris
        corners = [tuple(idx[i:i + channels]) for i in range(0, len(idx), channels)]
        if ptype == 0:
            return corners[:count * 3]
        if ptype == 1:                                   # triangle strip
            for k in range(count):
                a, b, c = corners[k], corners[k + 1], corners[k + 2]
                tris += [a, b, c] if k % 2 == 0 else [b, a, c]
            return tris
        self.warnings.append(f'primitiveType {ptype} ignorado')
        return []

    def parametric(self, geo, kind):
        """SCNPlane / SCNBox → triangle soup (positions, normals, uvs)."""
        ar = self.ar
        if kind == 'SCNPlane':
            w, h = ar.field(geo, 'width', 1.0), ar.field(geo, 'height', 1.0)
            r = min(ar.field(geo, 'cornerRadius', 0.0) or 0.0, w / 2, h / 2)
            seg = max(int(ar.field(geo, 'cornerSegmentCount', 10) or 10), 1) if r > 0 else 0
            ring = []
            if r > 0:
                for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
                    for k in range(seg + 1):
                        a = math.radians(a0 + 90 * k / seg)
                        ring.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            else:
                ring = [(w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2), (w / 2, -h / 2)]
            pos = [(0.0, 0.0, 0.0)] + [(x, y, 0.0) for x, y in ring]
            uv = [(0.5, 0.5)] + [(x / w + 0.5, 0.5 - y / h) for x, y in ring]
            nrm = [(0.0, 0.0, 1.0)] * len(pos)
            tris = []
            for k in range(1, len(ring) + 1):
                tris += [0, k, 1 + (k % len(ring))]
            return pos, nrm, uv, [tris]
        if kind == 'SCNBox':
            sx, sy, sz = ar.field(geo, 'boxwidth', 1.0) / 2, ar.field(geo, 'boxheight', 1.0) / 2, ar.field(geo, 'boxlength', 1.0) / 2
            pos, nrm, uv, tris = [], [], [], []
            faces = [((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (-1, 0, 0), (0, 1, 0)), ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
                     ((-1, 0, 0), (0, 0, 1), (0, 1, 0)), ((0, 1, 0), (1, 0, 0), (0, 0, -1)), ((0, -1, 0), (1, 0, 0), (0, 0, 1))]
            for n, u, v in faces:
                b = len(pos)
                for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    pos.append(tuple((n[i] * (sx, sy, sz)[i]) + du * u[i] * (sx, sy, sz)[i] + dv * v[i] * (sx, sy, sz)[i] for i in range(3)))
                    nrm.append(n); uv.append(((du + 1) / 2, (1 - dv) / 2))
                tris += [b, b + 1, b + 2, b, b + 2, b + 3]
            return pos, nrm, uv, [tris]
        return None

    def mesh(self, geo):
        key = id(geo)
        if key in self.meshes:
            return self.meshes[key]
        ar, g = self.ar, self.g
        kind = ar.cls(geo)
        mats = [self.material(m) for m in ar.array(geo, 'materials') if isinstance(m, dict)]
        prims = []
        if kind in ('SCNPlane', 'SCNBox'):
            pos, nrm, uv, groups = self.parametric(geo, kind)
            attrs = self.write_attrs(pos, nrm, [uv], None)
            for i, tris in enumerate(groups):
                prims.append(self.write_prim(attrs, tris, len(pos), mats[i % len(mats)] if mats else None))
        else:
            vsrc = ar.array(geo, 'kGeometrySourceSemanticVertex')
            if not vsrc:
                self.meshes[key] = None
                return None
            P = self.source_values(vsrc[0])[0]
            N = (self.source_values(ar.array(geo, 'kGeometrySourceSemanticNormal')[0])[0]
                 if ar.array(geo, 'kGeometrySourceSemanticNormal') else None)
            T = [self.source_values(s)[0] for s in ar.array(geo, 'kGeometrySourceSemanticTexcoord')]
            C = (self.source_values(ar.array(geo, 'kGeometrySourceSemanticColor')[0])
                 if ar.array(geo, 'kGeometrySourceSemanticColor') else None)
            elements = ar.array(geo, 'elements')
            channels = max((ar.field(e, 'indicesChannelCount', 1) or 1) for e in elements) if elements else 1
            if channels == 1:
                attrs = self.write_attrs(P, N, T, C)
                for i, e in enumerate(elements):
                    tris = [c[0] for c in self.element_triangles(e, 1)]
                    if tris:
                        prims.append(self.write_prim(attrs, tris, len(P), mats[i % len(mats)] if mats else None))
            else:
                # one index per source: match each channel to the source whose count fits its index range
                sources = [('P', P)] + ([('N', N)] if N else []) + [(f'T{i}', t) for i, t in enumerate(T)]
                for i, e in enumerate(elements):
                    corners = self.element_triangles(e, ar.field(e, 'indicesChannelCount', 1) or 1)
                    if not corners:
                        continue
                    nch = len(corners[0])
                    ranges = [max(c[k] for c in corners) for k in range(nch)]
                    mapping = {}
                    free = list(range(nch))
                    for name, values in sources:            # vertex first, then normal, then uvs
                        fit = [k for k in free if ranges[k] < len(values)]
                        if fit:
                            mapping[name] = fit[0]; free.remove(fit[0])
                    uniq, remap, tris = [], {}, []
                    for c in corners:
                        if c not in remap:
                            remap[c] = len(uniq); uniq.append(c)
                        tris.append(remap[c])
                    pos = [P[c[mapping['P']]] for c in uniq]
                    nrm = [N[c[mapping['N']]] for c in uniq] if 'N' in mapping else None
                    uvs = [[t[c[mapping[f'T{j}']]] for c in uniq] for j, t in enumerate(T) if f'T{j}' in mapping]
                    attrs = self.write_attrs(pos, nrm, uvs, None)
                    prims.append(self.write_prim(attrs, tris, len(pos), mats[i % len(mats)] if mats else None))
        if not prims:
            self.meshes[key] = None
            return None
        g.j['meshes'].append({'name': ar.field(geo, 'name') or kind, 'primitives': prims})
        self.meshes[key] = len(g.j['meshes']) - 1
        return self.meshes[key]

    def write_attrs(self, P, N, T, C):
        g = self.g
        mn = [min(p[i] for p in P) for i in range(3)]
        mx = [max(p[i] for p in P) for i in range(3)]
        attrs = {'POSITION': g.accessor(b''.join(struct.pack('<3f', *p[:3]) for p in P), FLOAT, len(P), 'VEC3', ARRAY_BUFFER, (mn, mx))}
        if N and len(N) == len(P):
            def unit(n):
                l = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1.0
                return (n[0] / l, n[1] / l, n[2] / l)
            attrs['NORMAL'] = g.accessor(b''.join(struct.pack('<3f', *unit(n)) for n in N), FLOAT, len(N), 'VEC3', ARRAY_BUFFER)
        for i, t in enumerate(T):
            if len(t) == len(P):     # SceneKit and glTF both put the UV origin at the top-left
                attrs[f'TEXCOORD_{i}'] = g.accessor(b''.join(struct.pack('<2f', *uv[:2]) for uv in t), FLOAT, len(t), 'VEC2', ARRAY_BUFFER)
        if C and len(C[0]) == len(P) and C[1] in (3, 4):
            vals, comps = C
            attrs['COLOR_0'] = g.accessor(b''.join(struct.pack(f'<{comps}f', *[float(x) for x in v]) for v in vals),
                                          FLOAT, len(vals), 'VEC3' if comps == 3 else 'VEC4', ARRAY_BUFFER)
        return attrs

    def write_prim(self, attrs, tris, nverts, mat):
        ctype, fmt = (U16, 'H') if nverts < 65536 else (U32, 'I')
        prim = {'attributes': attrs, 'indices': self.g.accessor(struct.pack(f'<{len(tris)}{fmt}', *tris), ctype, len(tris), 'SCALAR', ELEMENT_ARRAY_BUFFER), 'mode': 4}
        if mat is not None:
            prim['material'] = mat
        return prim

    # ---- nodes
    def node(self, n):
        ar = self.ar
        name = ar.field(n, 'name') or ''
        geo = ar.field(n, 'geometry')
        gkind = ar.cls(geo) if geo else None
        if ar.field(n, 'hidden') or SKIP_NAMES.match(name) or gkind == 'SCNText':
            return None
        out = {}
        if name:
            out['name'] = name
        t, s = floats(ar.field(n, 'position'), 3), floats(ar.field(n, 'scale'), 3)
        q = floats(ar.field(n, 'orientation'), 4)
        if q is None and floats(ar.field(n, 'rotation'), 4):
            q = quat_axis_angle(*floats(ar.field(n, 'rotation'), 4))
        if t and any(abs(v) > 1e-9 for v in t):
            out['translation'] = t
        if q and (abs(q[3] - 1) > 1e-9 or any(abs(v) > 1e-9 for v in q[:3])):
            l = math.sqrt(sum(v * v for v in q)) or 1.0
            out['rotation'] = [v / l for v in q]
        if s and any(abs(v - 1) > 1e-9 for v in s):
            out['scale'] = s
        if geo is not None:
            mi = self.mesh(geo)
            if mi is not None:
                out['mesh'] = mi
                mats = [ar.field(m, 'name') or '' for m in ar.array(geo, 'materials') if isinstance(m, dict)]
                label = ' '.join([name, ar.field(geo, 'name') or ''] + mats)
                is_screen = (SCREEN_RE.search(label) or re.search(r'(^|[^_A-Za-z])Screen($|[ _](cornerAdjustable|16:9))', label)) \
                    and not re.search(r'Glass_Screen|Screen_Edge', name)
                if is_screen:
                    self.screens.append({'node': name, 'mesh': self.g.j['meshes'][mi]['name'], 'materials': mats})
        kids = [self.node(c) for c in ar.array(n, 'childNodes') if isinstance(c, dict)]
        kids = [k for k in kids if k is not None]
        if kids:
            out['children'] = kids
        self.g.j['nodes'].append(out)
        return len(self.g.j['nodes']) - 1

    def run(self):
        scene = self.ar.find('SCNScene')
        if not scene:
            raise ValueError('el archivo no contiene una SCNScene')
        root = self.ar.field(scene[0], 'rootNode')
        top = [self.node(c) for c in self.ar.array(root, 'childNodes') if isinstance(c, dict)]
        self.g.j['scenes'][0]['nodes'] = [t for t in top if t is not None]
        return self.g.glb()


def metadata(ar):
    meta = ar.find('Rotato.DeviceSceneMetadata')
    m = {}
    if meta:
        for k, v in meta[0].items():
            v = ar.get(v)
            if isinstance(v, (str, int, float)) and k.startswith('mmd.') and k != 'mmd.thumbnailImage':
                m[k[4:]] = v
    size = None
    if isinstance(m.get('screensize'), str):
        nums = [int(float(x)) for x in re.findall(r'[\d.]+', m['screensize'])][:2]
        size = nums if len(nums) == 2 else None
    if not size:
        for s in ar.o:
            if isinstance(s, str) and (mm := SCREEN_RE.search(s)):
                size = [int(mm.group(1)), int(mm.group(2))]
                break
    return m, size


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('filter', nargs='?', default='', help='convertir solo escenas cuyo nombre contenga este texto')
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--out', default=DEFAULT_OUT)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    files = sorted(f for f in os.listdir(args.src) if f.endswith('.rotato') and args.filter.lower() in f.lower())
    manifest_path = os.path.join(args.out, 'manifest.json')
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = {e['file']: e for e in json.load(f).get('models', [])}
    ok = 0
    for f in files:
        name = f[:-7]
        try:
            ar = Archive(os.path.join(args.src, f))
            conv = Converter(ar)
            glb = conv.run()
            meta, size = metadata(ar)
            out = slug(name) + '.glb'
            with open(os.path.join(args.out, out), 'wb') as fh:
                fh.write(glb)
            thumb = os.path.join(args.src, name + '.png')
            if os.path.exists(thumb):
                with open(thumb, 'rb') as src, open(os.path.join(args.out, slug(name) + '.png'), 'wb') as dst:
                    dst.write(src.read())
            manifest[out] = {'file': out, 'name': meta.get('name', name), 'source': f, 'screenSize': size,
                             'screens': conv.screens, 'colorableMaterials': sorted(conv.colorable),
                             'thumbnail': slug(name) + '.png' if os.path.exists(thumb) else None,
                             'meshes': len(conv.g.j['meshes']), 'bytes': len(glb)}
            ok += 1
            warn = f"  ⚠ {'; '.join(sorted(set(conv.warnings)))}" if conv.warnings else ''
            print(f'✓ {name:<34} → {out:<34} {len(glb) / 1e6:6.1f} MB  mallas={len(conv.g.j["meshes"]):<3} pantallas={len(conv.screens)}{warn}')
        except Exception as e:  # keep going: one broken download should not stop the batch
            print(f'✗ {name:<34} {e}', file=sys.stderr)
    with open(manifest_path, 'w') as fh:
        json.dump({'note': 'Modelos convertidos de escenas de Rotato descargadas por el usuario. Solo uso personal; no publicar.',
                   'models': sorted(manifest.values(), key=lambda e: e['name'].lower())}, fh, indent=1, ensure_ascii=False)
    print(f'\n{ok}/{len(files)} escenas convertidas en {os.path.abspath(args.out)}')


if __name__ == '__main__':
    main()

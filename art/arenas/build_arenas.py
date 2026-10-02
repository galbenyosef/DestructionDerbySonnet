"""Builds the scenery of the Frozen Lake, the Mud Quarry and the Container Port in Blender and exports one GLB per arena.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py            # all three
    ARENA=ice QUICK=1 PREVIEW=1 ... --python art/arenas/build_arenas.py                                  # one, with preview renders

Environment: ARENA (ice | quarry | port | all), OUT (folder of the GLBs, default src/client/assets), PREVIEW (folder for PNG renders; off
by default), QUICK (fewer render samples).

The walls, obstacles and ramps are built from the very boxes of `layouts.py` (the physics), so the scenery sits exactly where the colliders
are. Game axes: X forward, Y up, Z right; Blender: X forward, Y left, Z up, so a game point (x, y, z) is Blender (x, -z, y), and the glTF
exporter turns it back. Everything is merged per (group, material) to keep the draw calls few. Group names the game relies on: `ground`,
`walls`, `obstacles`, `props` (decoration near the arena; the Low preset hides it) and `far` (the backdrop; Low hides it too).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.dont_write_bytecode = True  # importing layouts.py must not leave a __pycache__ in the repository
sys.path.insert(0, HERE)
import layouts  # noqa: E402

OUT = os.environ.get('OUT', os.path.join(ROOT, 'src', 'client', 'assets'))
PREVIEW = os.environ.get('PREVIEW', '')
QUICK = bool(os.environ.get('QUICK'))


def srgb(hex_colour):
    h = hex_colour.lstrip('#') if isinstance(hex_colour, str) else '%06x' % hex_colour
    return tuple(((int(h[i:i + 2], 16) / 255.0) ** 2.2) for i in (0, 2, 4)) + (1.0,)


def G(x, y, z):
    """A game point as a Blender point."""
    return Vector((x, -z, y))


def yaw_pitch(yaw, pitch=0.0):
    """The game's rotation of a box (yaw about +Y, after a pitch about its own Z axis that lifts +X) as a Blender quaternion."""
    return Quaternion((0, 0, 1), yaw) @ Quaternion((0, 1, 0), -pitch)


class Scene:
    def __init__(self, name):
        self.name = name
        self.meshes = {}  # (group, material name) -> bmesh
        self.materials = {}

    def mat(self, name, colour, rough=0.85, metal=0.0, emit=0.0):
        if name not in self.materials:
            m = bpy.data.materials.new(f'{self.name}_{name}')
            m.use_nodes = True
            bsdf = m.node_tree.nodes['Principled BSDF']
            bsdf.inputs['Base Color'].default_value = srgb(colour)
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            if emit:
                bsdf.inputs['Emission Color'].default_value = srgb(colour)
                bsdf.inputs['Emission Strength'].default_value = emit
            self.materials[name] = m
        return name

    def bm(self, group, mat):
        key = (group, mat)
        if key not in self.meshes:
            self.meshes[key] = bmesh.new()
        return self.meshes[key]

    # ---- primitives, in game coordinates (centre x, y, z; rotation as a Blender quaternion) ----
    def _place(self, bm, verts, scale, rot, centre):
        m = Matrix.Translation(G(*centre)) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
        bmesh.ops.transform(bm, matrix=m, verts=verts)

    def box(self, group, mat, centre, half, yaw=0.0, pitch=0.0, bevel=0.0, rot=None):
        """A box of half extents (hx, hy, hz) in game axes, optionally with its edges rounded off."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_cube(bm, size=2.0)['verts']
        self._place(bm, verts, (half[0], half[2], half[1]), rot or yaw_pitch(yaw, pitch), centre)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES')

    def sphere(self, group, mat, centre, radii, rot=None, subdiv=1, jitter=0.0, rnd=None):
        """An icosphere of radii (rx, ry, rz) in game axes; `jitter` roughens it."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)['verts']
        if jitter and rnd:
            for v in verts:
                v.co *= 1.0 + rnd.uniform(-jitter, jitter)
        self._place(bm, verts, (radii[0], radii[2], radii[1]), rot or Quaternion(), centre)

    def cone(self, group, mat, base_centre, r1, r2, height, segs=8, rot=None, cap=True):
        """A (truncated) cone standing on `base_centre` along game +Y."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=1.0)['verts']
        for v in verts:
            v.co.z += 0.5  # stand on the base
        x, y, z = base_centre
        self._place(bm, verts, (1.0, 1.0, height), rot or Quaternion(), (x, y, z))

    def quad(self, group, mat, a, b, c, d):
        """A flat face from four game points."""
        bm = self.bm(group, mat)
        vs = [bm.verts.new(G(*p)) for p in (a, b, c, d)]
        try:
            bm.faces.new(vs)
        except ValueError:
            pass

    def strip(self, group, mat, points, width, y=0.02):
        """A flat ribbon along game ground points (x, z)."""
        for (x0, z0), (x1, z1) in zip(points, points[1:]):
            dx, dz = x1 - x0, z1 - z0
            n = math.hypot(dx, dz) or 1.0
            ox, oz = -dz / n * width / 2, dx / n * width / 2
            self.quad(group, mat, (x0 - ox, y, z0 - oz), (x0 + ox, y, z0 + oz), (x1 + ox, y, z1 + oz), (x1 - ox, y, z1 - oz))

    def disc(self, group, mat, radius, y=0.0, segs=64):
        self.cone(group, mat, (0, y, 0), radius, radius, 0.0001, segs=segs)

    def finish(self):
        """Turns the accumulators into objects (one per group and material) under one empty named after the arena."""
        root = bpy.data.objects.new(f'arena_{self.name}', None)
        bpy.context.scene.collection.objects.link(root)
        for (group, mat), bm in sorted(self.meshes.items()):
            if not bm.verts:
                continue
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f'{group}_{mat}')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(self.materials[mat])
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(f'{group}_{mat}', me)
            ob.parent = root
            bpy.context.scene.collection.objects.link(ob)
        return root


def tri_count(root):
    total = 0
    for ob in root.children:
        me = ob.data
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
    return total


# ============================================================================== the Frozen Lake
def build_ice(layout):
    s = Scene('ice')
    r = random.Random(11)
    for name, col, rough in (('floor', 0xc9e3f4, 0.12), ('floor2', 0xb4d6ec, 0.15), ('crack', 0x4f86ad, 0.3), ('snow', 0xf3f7fd, 0.95),
                             ('snow2', 0xdfe9f4, 0.95), ('block', 0x86c3ea, 0.1), ('block2', 0xb8e0f5, 0.1), ('pine', 0x2c5a40, 0.9),
                             ('pine2', 0x3b6e4d, 0.9), ('trunk', 0x4a3a2c, 0.9), ('rock', 0x79838f, 0.9), ('mount', 0x93a5ba, 0.9),
                             ('cap', 0xffffff, 0.95)):
        s.mat(name, col, rough)
    s.disc('ground', 'floor', 175.0, 0.0, 72)
    # patches of a slightly darker ice and the cracks that run across it
    for _ in range(9):
        a, d = r.uniform(0, math.tau), r.uniform(8, 44)
        s.cone('ground', 'floor2', (math.cos(a) * d, 0.012, math.sin(a) * d), 1, 1, 0.0001, segs=9)
    for _ in range(16):
        a, d = r.uniform(0, math.tau), r.uniform(4, 44)
        x, z, h = math.cos(a) * d, math.sin(a) * d, r.uniform(0, math.tau)
        pts = [(x, z)]
        for _k in range(r.randint(3, 6)):
            h += r.uniform(-0.7, 0.7)
            x, z = x + math.cos(h) * r.uniform(2, 5), z + math.sin(h) * r.uniform(2, 5)
            pts.append((x, z))
        s.strip('ground', 'crack', pts, 0.1, 0.02)

    for b in layout['boxes']:
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        if b['kind'] == 'wall':  # a bank of snow: the collider box itself, rounded, with lumps on top
            s.box('walls', 'snow', c, half, yaw=b['yaw'], bevel=0.3)
            q = yaw_pitch(b['yaw'])
            for k in (-0.55, 0.0, 0.55):
                off = q @ Vector((k * half[0], 0, 0))
                s.sphere('walls', 'snow2', (c[0] + off.x, c[1] + 0.35, c[2] - off.y), (half[0] * 0.36, half[1] * 1.35, half[2] * 1.15), rot=q, rnd=r, jitter=0.1)
        else:  # a block of ice with shards
            s.box('obstacles', 'block', c, half, yaw=b['yaw'], bevel=0.2)
            q = yaw_pitch(b['yaw'])
            for _k in range(3):
                dx, dz = r.uniform(-0.6, 0.6) * half[0], r.uniform(-0.6, 0.6) * half[2]
                off = q @ Vector((dx, dz * -1, 0))
                lean = Quaternion((r.uniform(-1, 1), r.uniform(-1, 1), 0), r.uniform(0.0, 0.35))
                s.cone('obstacles', 'block2', (c[0] + off.x, c[1] + half[1] * 0.9, c[2] - off.y), r.uniform(0.35, 0.6), 0.0, r.uniform(1.2, 2.4), segs=5, rot=lean)

    # drifts along the outside of the bank, and the shore
    for k in range(70):
        a = k / 70 * math.tau + r.uniform(-0.03, 0.03)
        d = r.uniform(55.5, 60)
        s.sphere('props', 'snow', (math.cos(a) * d, r.uniform(-0.5, 0.0), math.sin(a) * d), (r.uniform(3, 6), r.uniform(1.4, 2.6), r.uniform(3, 6)), rnd=r, jitter=0.08)
    for _ in range(120):  # pines, the nearer ones bigger
        a, d = r.uniform(0, math.tau), r.uniform(64, 100)
        sc = r.uniform(0.8, 1.7)
        x, z = math.cos(a) * d, math.sin(a) * d
        s.cone('props', 'trunk', (x, 0, z), 0.22 * sc, 0.2 * sc, 1.2 * sc, segs=5)
        m = 'pine' if r.random() < 0.6 else 'pine2'
        s.cone('props', m, (x, 0.9 * sc, z), 1.7 * sc, 0.15 * sc, 2.6 * sc, segs=7)
        s.cone('props', m, (x, 2.3 * sc, z), 1.3 * sc, 0.1 * sc, 2.3 * sc, segs=7)
        s.cone('props', 'cap', (x, 3.7 * sc, z), 0.55 * sc, 0.0, 1.2 * sc, segs=7)
    for _ in range(26):
        a, d = r.uniform(0, math.tau), r.uniform(62, 96)
        s.sphere('props', 'rock', (math.cos(a) * d, 0.2, math.sin(a) * d), (r.uniform(0.8, 2.2), r.uniform(0.6, 1.4), r.uniform(0.8, 2.2)), rnd=r, jitter=0.2)
    # far hills and mountains
    for k in range(16):
        a = k / 16 * math.tau + r.uniform(-0.1, 0.1)
        d = r.uniform(120, 135)
        s.sphere('far', 'snow2', (math.cos(a) * d, -4, math.sin(a) * d), (r.uniform(24, 40), r.uniform(14, 24), r.uniform(24, 40)), subdiv=2, rnd=r, jitter=0.06)
    for k in range(14):
        a = k / 14 * math.tau + r.uniform(-0.12, 0.12)
        d = r.uniform(158, 178)
        h = r.uniform(45, 85)
        rad = r.uniform(30, 48)
        s.cone('far', 'mount', (math.cos(a) * d, -2, math.sin(a) * d), rad, 0.0, h, segs=7)
        s.cone('far', 'cap', (math.cos(a) * d, -2 + h * 0.62, math.sin(a) * d), rad * 0.38, 0.0, h * 0.38, segs=7)
    return s


def local_pt(centre, q, lx, ly, lz):
    """The game point at local game offset (lx, ly, lz) of a box centred on `centre` and rotated by the Blender quaternion `q`."""
    off = q @ Vector((lx, -lz, ly))
    return (centre[0] + off.x, centre[1] + off.z, centre[2] - off.y)


def axis_quat(axis, angle):
    return Quaternion(axis, angle)


# ============================================================================== the Mud Quarry
def build_quarry(layout):
    s = Scene('quarry')
    r = random.Random(23)
    for name, col, rough in (('dirt', 0x8a5a32, 0.95), ('dirt2', 0x7a4e2b, 0.95), ('track', 0x4e3220, 0.95), ('rock1', 0x8d6a45, 0.9),
                             ('rock2', 0xa4794b, 0.9), ('rock3', 0x6e4a2c, 0.9), ('strata', 0xc9a56e, 0.9), ('wood', 0x9b7a4a, 0.85),
                             ('wood2', 0x6e5232, 0.85), ('gravel', 0x9a8f80, 0.95), ('yellow', 0xd9a521, 0.6), ('metal', 0x7d8186, 0.5),
                             ('dark', 0x23201d, 0.8), ('glass', 0x6aa3b8, 0.2), ('barrel', 0xb23a2c, 0.6), ('barrel2', 0x2f6aa8, 0.6),
                             ('mesa', 0xb2764a, 0.9), ('mesa2', 0x94623d, 0.9), ('lamp', 0xffd9a0, 0.4)):
        s.mat(name, col, rough, emit=6.0 if name == 'lamp' else 0.0)
    pts = layout['bounds']['points']
    n = len(pts)
    a_ax, b_ax = 62.0, 42.0
    s.disc('ground', 'dirt', 200.0, 0.0, 72)
    for k in range(3):  # worn tracks round the pit floor
        f = 0.35 + 0.2 * k
        ring = [(a_ax * f * math.cos(t / 48 * math.tau + k), b_ax * f * math.sin(t / 48 * math.tau + k)) for t in range(49)]
        for dx in (-0.9, 0.9):
            s.strip('ground', 'track', [(x + dx * 0.4, z + dx * 0.4) for x, z in ring], 0.7, 0.02)
    for _ in range(14):
        a, rr = r.uniform(0, math.tau), r.uniform(0.2, 0.85)
        s.cone('ground', 'dirt2', (a_ax * rr * math.cos(a), 0.012, b_ax * rr * math.sin(a)), r.uniform(2, 5), r.uniform(2, 5), 0.0001, segs=9)

    # terraced rock rising away from the wall (the wall's outer face is at about 2 m from the outline)
    def pt(off, i):
        x, z = pts[i % n]
        nx, nz = x / (a_ax * a_ax), z / (b_ax * b_ax)
        ln = math.hypot(nx, nz) or 1.0
        j = random.Random(i * 31 + int(off * 7)).uniform(-0.8, 0.8)
        return (x + nx / ln * (off + j), z + nz / ln * (off + j))
    levels = [(2.0, 3.0), (9.0, 6.5), (17.0, 10.0), (27.0, 13.5), (40.0, 16.0)]
    for lv in range(len(levels) - 1):
        (o0, h0), (o1, h1) = levels[lv], levels[lv + 1]
        for i in range(n):
            p0, p1 = pt(o0, i), pt(o0, i + 1)
            q0, q1 = pt(o1, i), pt(o1, i + 1)
            mat_top = 'rock1' if (i + lv) % 3 else 'rock2'
            s.quad('walls', mat_top, (p0[0], h0, p0[1]), (q0[0], h1, q0[1]), (q1[0], h1, q1[1]), (p1[0], h0, p1[1]))
    for lv in range(1, len(levels)):  # the cliff faces between terraces, with a band of lighter strata
        (o1, h1) = levels[lv]
        (_, h0) = levels[lv - 1]
        for i in range(n):
            p0, p1 = pt(o1, i), pt(o1, i + 1)
            mid = h0 + (h1 - h0) * 0.55
            s.quad('walls', 'rock3', (p0[0], h0, p0[1]), (p0[0], mid, p0[1]), (p1[0], mid, p1[1]), (p1[0], h0, p1[1]))
            s.quad('walls', 'strata', (p0[0], mid, p0[1]), (p0[0], h1, p0[1]), (p1[0], h1, p1[1]), (p1[0], mid, p1[1]))

    for b in layout['boxes']:
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        q = yaw_pitch(b['yaw'], b.get('pitch', 0.0))
        if b['kind'] == 'wall':  # a rock face with a band of strata and boulders on top
            s.box('walls', 'rock1', c, half, yaw=b['yaw'], bevel=0.12)
            s.box('walls', 'strata', (c[0], c[1] + 0.25, c[2]), (half[0] * 0.99, 0.22, half[2] + 0.05), yaw=b['yaw'])
            if r.random() < 0.6:
                off = local_pt(c, q, r.uniform(-half[0], half[0]) * 0.8, half[1] + 0.2, 0)
                s.sphere('walls', 'rock3', off, (r.uniform(0.7, 1.4), r.uniform(0.5, 1.0), r.uniform(0.7, 1.2)), rnd=r, jitter=0.25)
        elif b['kind'] == 'block':  # the mound
            s.box('obstacles', 'dirt2', c, half, yaw=b['yaw'], bevel=0.25)
            for _ in range(7):
                s.sphere('obstacles', 'gravel', (c[0] + r.uniform(-4.5, 4.5), c[1] + half[1] - 0.05, c[2] + r.uniform(-4.5, 4.5)), (r.uniform(0.8, 1.6), 0.28, r.uniform(0.8, 1.6)), rnd=r, jitter=0.15)
        else:  # a ramp of planks
            s.box('obstacles', 'wood', c, half, yaw=b['yaw'], pitch=b.get('pitch', 0.0), bevel=0.04)
            for k in range(-4, 5):
                p = local_pt(c, q, 0, half[1] + 0.01, k * half[2] / 4.4)
                s.box('obstacles', 'wood2', p, (half[0] * 0.995, 0.015, 0.03), rot=q)
            for sgn in (-1, 1):
                p = local_pt(c, q, 0, half[1] + 0.12, sgn * (half[2] - 0.08))
                s.box('obstacles', 'wood2', p, (half[0] * 0.99, 0.12, 0.08), rot=q)

    # machinery on the first terrace: an excavator and a dump truck
    def excavator(x, z, yaw, y=6.5):
        q = yaw_pitch(yaw)
        for sgn in (-1, 1):
            s.box('props', 'dark', local_pt((x, y, z), q, 0, 0.45, sgn * 1.1), (2.0, 0.45, 0.45), rot=q, bevel=0.1)
        s.box('props', 'yellow', local_pt((x, y, z), q, 0, 1.2, 0), (1.6, 0.5, 1.2), rot=q, bevel=0.1)
        s.box('props', 'yellow', local_pt((x, y, z), q, -0.4, 2.2, 0.2), (0.9, 0.7, 0.8), rot=q, bevel=0.08)
        s.box('props', 'glass', local_pt((x, y, z), q, 0.1, 2.35, 0.2), (0.85, 0.45, 0.82), rot=q)
        arm = q @ Quaternion((0, 1, 0), -0.7)
        s.box('props', 'yellow', local_pt((x, y, z), q, 2.4, 2.9, -0.4), (2.2, 0.22, 0.22), rot=arm)
        arm2 = q @ Quaternion((0, 1, 0), 0.9)
        s.box('props', 'yellow', local_pt((x, y, z), q, 4.6, 2.6, -0.4), (1.6, 0.18, 0.18), rot=arm2)
        s.box('props', 'metal', local_pt((x, y, z), q, 5.7, 1.5, -0.4), (0.5, 0.45, 0.6), rot=q, bevel=0.05)

    def truck(x, z, yaw, y=6.5):
        q = yaw_pitch(yaw)
        s.box('props', 'yellow', local_pt((x, y, z), q, 2.3, 1.7, 0), (1.1, 0.9, 1.3), rot=q, bevel=0.1)
        s.box('props', 'glass', local_pt((x, y, z), q, 3.0, 2.0, 0), (0.45, 0.4, 1.2), rot=q)
        s.box('props', 'metal', local_pt((x, y, z), q, -0.6, 1.3, 0), (3.0, 0.15, 1.3), rot=q)
        bed = q @ Quaternion((0, 1, 0), -0.18)
        s.box('props', 'yellow', local_pt((x, y, z), q, -0.7, 2.0, 0), (2.6, 0.75, 1.4), rot=bed, bevel=0.1)
        for wx in (-2.4, 0.2, 2.5):
            for sgn in (-1, 1):
                s.cone('props', 'dark', local_pt((x, y, z), q, wx, 0.0, sgn * 1.45), 0.9, 0.9, 0.55, segs=10, rot=q @ Quaternion((1, 0, 0), math.pi / 2))

    excavator(*pt(5.5, 6), yaw=0.4)
    excavator(*pt(5.5, 27), yaw=3.5)
    truck(*pt(5.0, 14), yaw=-1.2)
    truck(*pt(5.0, 33), yaw=1.9)
    for _ in range(30):  # barrels, gravel piles and boulders on the terraces
        i = r.randrange(n)
        x, z = pt(r.uniform(3.5, 8.0), i)
        y = 6.5 if r.random() < 0.8 else 3.0
        k = r.random()
        if k < 0.3:
            s.cone('props', r.choice(['barrel', 'barrel2']), (x, y, z), 0.4, 0.4, 0.9, segs=8)
        elif k < 0.65:
            s.cone('props', 'gravel', (x, y, z), r.uniform(1.4, 2.6), 0.2, r.uniform(1.0, 2.0), segs=7)
        else:
            s.sphere('props', 'rock3', (x, y + 0.4, z), (r.uniform(0.8, 1.8), r.uniform(0.6, 1.2), r.uniform(0.8, 1.6)), rnd=r, jitter=0.25)
    for i in range(2, n, 8):  # floodlight masts on the rim
        x, z = pt(9.0, i)
        s.cone('props', 'metal', (x, 6.5, z), 0.22, 0.18, 12.0, segs=6)
        s.box('props', 'lamp', (x, 18.7, z), (1.2, 0.2, 0.5), yaw=math.atan2(-z, x))
    for k in range(18):  # mesas on the horizon
        a = k / 18 * math.tau + r.uniform(-0.1, 0.1)
        d = r.uniform(150, 185)
        h = r.uniform(26, 55)
        rad = r.uniform(28, 46)
        s.cone('far', 'mesa' if k % 2 else 'mesa2', (math.cos(a) * d, -2, math.sin(a) * d), rad, rad * r.uniform(0.55, 0.8), h, segs=9)
    return s


# ============================================================================== the Container Port
def build_port(layout):
    s = Scene('port')
    r = random.Random(37)
    for name, col, rough, metal in (('asphalt', 0x4a4d52, 0.9, 0), ('asphalt2', 0x55585d, 0.9, 0), ('gravel', 0x6f6a60, 0.95, 0), ('line_y', 0xe3b023, 0.7, 0),
                                    ('line_w', 0xdcdcdc, 0.7, 0), ('concrete', 0x8d9096, 0.9, 0), ('concrete2', 0x6f7277, 0.9, 0), ('red', 0xc8372d, 0.7, 0),
                                    ('white', 0xe8e8e8, 0.7, 0), ('steel', 0x9aa0a6, 0.45, 0.6), ('steel_d', 0x5f656b, 0.5, 0.6), ('dark', 0x1f2226, 0.8, 0),
                                    ('water', 0x1d3a52, 0.1, 0), ('hull', 0x2c3f52, 0.6, 0.2), ('crane', 0xc8372d, 0.6, 0.2), ('lamp', 0xffb066, 0.4, 0),
                                    ('wall', 0x9a9a92, 0.9, 0), ('glass', 0x7aa5b8, 0.2, 0.3), ('city', 0x2b3342, 0.9, 0), ('city2', 0x3a4256, 0.9, 0),
                                    ('c0', 0xb5532a, 0.6, 0.2), ('c1', 0x2f6aa8, 0.6, 0.2), ('c2', 0x3f8a4f, 0.6, 0.2), ('c3', 0xc9a227, 0.6, 0.2),
                                    ('c0d', 0x8b3d1f, 0.6, 0.2), ('c1d', 0x214d7c, 0.6, 0.2), ('c2d', 0x2d6139, 0.6, 0.2), ('c3d', 0x967a1c, 0.6, 0.2)):
        s.mat(name, col, rough, metal, emit=7.0 if name == 'lamp' else 0.0)
    hx, hz = 45.0, 33.0
    # the yard's apron, the gravel round it and the sea beyond the quay on the +X side
    s.disc('ground', 'gravel', 190.0, -0.5, 72)
    s.box('ground', 'asphalt', (0, -0.25, 0), (hx + 18, 0.25, hz + 18))
    for _ in range(14):
        s.box('ground', 'asphalt2', (r.uniform(-hx, hx), 0.012, r.uniform(-hz, hz)), (r.uniform(2, 6), 0.0005, r.uniform(1.5, 4)), yaw=r.uniform(0, 3))
    s.box('ground', 'water', (hx + 18 + 70, -1.9, 0), (70, 0.5, 120))
    s.box('ground', 'concrete', (hx + 18.5, -0.45, 0), (0.6, 0.55, hz + 18))  # the quay edge
    # lane markings: a dashed yellow line 4 m inside the wall, a white cross, hazard stripes by the ramps
    def dashed(x0, z0, x1, z1, mat, width=0.18):
        length = math.hypot(x1 - x0, z1 - z0)
        steps = int(length // 6)
        ux, uz = (x1 - x0) / length, (z1 - z0) / length
        for k in range(steps):
            a0, a1 = k * 6, k * 6 + 3
            s.strip('ground', mat, [(x0 + ux * a0, z0 + uz * a0), (x0 + ux * a1, z0 + uz * a1)], width, 0.02)
    dashed(-hx + 4, -hz + 4, hx - 4, -hz + 4, 'line_y')
    dashed(-hx + 4, hz - 4, hx - 4, hz - 4, 'line_y')
    dashed(-hx + 4, -hz + 4, -hx + 4, hz - 4, 'line_y')
    dashed(hx - 4, -hz + 4, hx - 4, hz - 4, 'line_y')
    dashed(-hx + 10, 0, hx - 10, 0, 'line_w', 0.3)
    dashed(0, -hz + 10, 0, hz - 10, 'line_w', 0.3)

    for idx, b in enumerate(layout['boxes']):
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        q = yaw_pitch(b['yaw'], b.get('pitch', 0.0))
        if b['kind'] == 'wall':  # a concrete barrier with a red or white band
            s.box('walls', 'concrete', c, half, yaw=b['yaw'], bevel=0.1)
            s.box('walls', 'red' if idx % 2 else 'white', (c[0], c[1] + 0.35, c[2]), (half[0] * 0.98, 0.22, half[2] + 0.04), yaw=b['yaw'])
            s.box('walls', 'concrete2', (c[0], c[1] + half[1] - 0.05, c[2]), (half[0] * 0.98, 0.08, half[2] + 0.06), yaw=b['yaw'])
        elif b['kind'] == 'container':
            t = b.get('tint', 0) % 4
            s.box('obstacles', f'c{t}', c, half, yaw=b['yaw'], bevel=0.04)
            for sgn in (-1, 1):  # the corrugation
                for k in range(-4, 5):
                    p = local_pt(c, q, k * half[0] / 4.6, 0, sgn * (half[2] + 0.02))
                    s.box('obstacles', f'c{t}d', p, (0.07, half[1] * 0.92, 0.04), rot=q)
            end = local_pt(c, q, half[0] + 0.02, 0, 0)  # the doors
            s.box('obstacles', f'c{t}d', end, (0.03, half[1] * 0.95, half[2] * 0.95), rot=q)
            for sgn in (-0.4, 0.4):
                s.box('obstacles', 'steel', local_pt(c, q, half[0] + 0.06, 0, sgn * half[2]), (0.03, half[1] * 0.85, 0.04), rot=q)
        else:  # a steel ramp with chevrons
            s.box('obstacles', 'steel', c, half, yaw=b['yaw'], pitch=b.get('pitch', 0.0), bevel=0.04)
            for k in range(-3, 4):
                p = local_pt(c, q, k * half[0] / 3.4, half[1] + 0.012, 0)
                s.box('obstacles', 'line_y' if k % 2 == 0 else 'dark', p, (half[0] / 8, 0.012, half[2] * 0.96), rot=q)
            for sgn in (-1, 1):
                s.box('obstacles', 'steel_d', local_pt(c, q, 0, half[1] + 0.1, sgn * (half[2] - 0.06)), (half[0], 0.1, 0.06), rot=q)

    # the fence round the yard, light masts, stacks of containers, a warehouse, the cranes and a ship at the quay
    fx, fz = hx + 8, hz + 8
    for k in range(-int(fx // 3), int(fx // 3) + 1):
        for sgn in (-1, 1):
            if sgn > 0 and False:
                continue
            s.box('props', 'steel_d', (k * 3.0, 1.2, sgn * fz), (0.06, 1.2, 0.06))
    for k in range(-int(fz // 3), int(fz // 3) + 1):
        s.box('props', 'steel_d', (-fx, 1.2, k * 3.0), (0.06, 1.2, 0.06))
        s.box('props', 'steel_d', (fx, 1.2, k * 3.0), (0.06, 1.2, 0.06))
    for sgn in (-1, 1):
        s.box('props', 'steel', (0, 2.35, sgn * fz), (fx, 0.04, 0.04))
        s.box('props', 'steel', (0, 0.1, sgn * fz), (fx, 0.04, 0.04))
        s.box('props', 'dark', (0, 1.2, sgn * fz), (fx, 1.1, 0.02))
    s.box('props', 'steel', (-fx, 2.35, 0), (0.04, 0.04, fz))
    s.box('props', 'dark', (-fx, 1.2, 0), (0.02, 1.1, fz))
    s.box('props', 'steel', (fx, 2.35, 0), (0.04, 0.04, fz))
    s.box('props', 'dark', (fx, 1.2, 0), (0.02, 1.1, fz))
    for px, pz in ((-fx, -fz), (fx, -fz), (-fx, fz), (fx, fz), (0, -fz), (0, fz), (-fx, 0), (fx, 0)):
        s.box('props', 'steel_d', (px, 7.5, pz), (0.18, 7.5, 0.18))
        s.box('props', 'lamp', (px, 15.1, pz), (0.9, 0.12, 0.45), yaw=math.atan2(-pz, px) + 1.57)
    for row in range(5):  # stacked containers behind the fence on the far sides
        for col in range(7):
            for lvl in range(r.randint(1, 3)):
                t = r.randrange(4)
                s.box('props', f'c{t}', (-hx - 24 - row * 2.6, 1.3 + lvl * 2.6, -hz + 4 + col * 6.3 - 18), (1.2, 1.3, 3.0), bevel=0.04)
    for col in range(8):
        for lvl in range(r.randint(1, 3)):
            t = r.randrange(4)
            s.box('props', f'c{t}', (-hx + 4 + col * 6.3, 1.3 + lvl * 2.6, -hz - 22), (3.0, 1.3, 1.2), bevel=0.04)
    s.box('props', 'wall', (10, 5, hz + 34), (24, 5, 9), bevel=0.2)
    s.box('props', 'steel_d', (10, 10.4, hz + 34), (24.5, 0.4, 9.5))
    for k in range(6):
        s.box('props', 'dark', (-10 + k * 8, 3, hz + 24.9), (2.2, 3, 0.1))
    for cz in (-22, 20):  # gantry cranes on the quay
        for lx in (-5, 5):
            for lz in (-6, 6):
                s.box('props', 'crane', (hx + 14 + lx * 0.2, 15, cz + lz), (0.45, 15, 0.45))
        s.box('props', 'crane', (hx + 14, 30.5, cz), (1.0, 1.0, 22))
        s.box('props', 'crane', (hx + 14 + 14, 30.5, cz), (14, 0.8, 0.8))
        s.box('props', 'steel_d', (hx + 24, 27.5, cz), (1.6, 1.6, 1.6))
    s.box('props', 'hull', (hx + 56, 1.2, 0), (9, 4.2, 50), bevel=0.4)  # a ship alongside
    s.box('props', 'red', (hx + 56, -1.0, 0), (9.05, 0.8, 50.05))
    s.box('props', 'white', (hx + 62, 9, 40), (4, 6, 6), bevel=0.2)
    for row in range(3):
        for col in range(10):
            for lvl in range(2):
                s.box('props', f'c{(row + col + lvl) % 4}', (hx + 51 + row * 2.6, 6.0 + lvl * 2.6, -42 + col * 6.3), (1.2, 1.3, 3.0))
    for k in range(7):  # bollards
        s.cone('props', 'line_y', (hx + 17.2, 0.0, -45 + k * 15), 0.35, 0.3, 0.7, segs=8)
    # distant city
    for k in range(60):
        a = r.uniform(math.pi * 0.35, math.pi * 1.65)
        d = r.uniform(130, 170)
        w, h = r.uniform(5, 14), r.uniform(10, 55)
        s.box('far', 'city' if k % 2 else 'city2', (math.cos(a) * d, h / 2 - 1, math.sin(a) * d), (w, h / 2, w * r.uniform(0.7, 1.4)), yaw=r.uniform(0, 3))
    return s


BUILDERS = {'ice': build_ice, 'quarry': build_quarry, 'port': build_port}


# ============================================================================== export and preview
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(root, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'arena_{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for c in root.children:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False, export_image_format='NONE')
    return path


def preview(name, layout):
    if not PREVIEW:
        return
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    look = layout['look']
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 12 if QUICK else 48
    scn.cycles.use_denoising = False
    scn.render.resolution_x, scn.render.resolution_y = (900, 506) if QUICK else (1280, 720)
    scn.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = srgb(look['sky'])
    bg.inputs['Strength'].default_value = 1.0
    scn.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun.color = srgb(look['sun'])[:3]
    sob = bpy.data.objects.new('sun', sun)
    sob.rotation_euler = (math.radians(55), 0, math.radians(35))
    scn.collection.objects.link(sob)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 28
    cam.clip_end = 900
    cob = bpy.data.objects.new('cam', cam)
    scn.collection.objects.link(cob)
    scn.camera = cob
    reach = 55
    views = {
        'over': (G(-reach * 0.95, reach * 0.85, reach * 0.95), G(0, 0, 0)),
        'low': (G(-reach * 0.55, 3.4, reach * 0.15), G(reach * 0.4, 1.5, -reach * 0.1)),
        'rim': (G(reach * 0.92, 5.5, -reach * 0.1), G(-reach * 0.2, 0.5, reach * 0.1)),
    }
    for vname, (pos, target) in views.items():
        cob.location = pos
        cob.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(PREVIEW, f'{name}_{vname}.png')
        bpy.ops.render.render(write_still=True)


def main():
    which = os.environ.get('ARENA', 'all')
    names = list(BUILDERS) if which == 'all' else [which]
    for name in names:
        reset()
        layout = {'ice': layouts.ice, 'quarry': layouts.quarry, 'port': layouts.port}[name]()
        root = BUILDERS[name](layout).finish()
        print(f'{name}: {tri_count(root)} triangles in {len(root.children)} meshes')
        path = export(root, name)
        print(f'{name}: wrote {path} ({os.path.getsize(path) // 1024} KB)')
        preview(name, layout)


main()

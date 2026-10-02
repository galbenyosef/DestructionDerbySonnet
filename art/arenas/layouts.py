#!/usr/bin/env python3
"""The layouts of the four arenas, as data. Run `python3 art/arenas/layouts.py` from the repository root to write
src/shared/arenas/<id>.json, which the server and the browser both build the physics from (the Blender scenery script
imports this module too, so the walls you see are the walls you hit).

Axes as in the game: X forward, Y up, Z right; a box's `yaw` turns it about +Y, its `pitch` tilts it about its own Z axis
(a positive pitch lifts the +X end: a ramp). Numbers are rounded the way the game rounds them (millimetres, micro-radians).
"""
import json
import math
import os

TAU = math.tau


def r3(v):
    return math.floor(v * 1e3 + 0.5) / 1e3


def r6(v):
    return math.floor(v * 1e6 + 0.5) / 1e6


def box(kind, x, y, z, yaw, hx, hy, hz, pitch=0.0, tint=None):
    b = {'kind': kind, 'x': r3(x), 'y': r3(y), 'z': r3(z), 'yaw': r6(yaw), 'hx': r3(hx), 'hy': r3(hy), 'hz': r3(hz)}
    if pitch:
        b['pitch'] = r6(pitch)
    if tint is not None:
        b['tint'] = tint
    return b


def ring_walls(radius, segments, half_h, half_t, kind='wall'):
    """A regular polygon of wall boxes whose inner faces sit at `radius` (the Stadium's formula, bit for bit)."""
    r = radius + half_t
    hx = r3(r * math.tan(math.pi / segments) + 0.3)  # +0.3 overlaps the neighbours so there are no gaps
    out = []
    for i in range(segments):
        a = (i / segments) * TAU
        out.append(box(kind, math.cos(a) * r, half_h, math.sin(a) * r, -a - math.pi / 2, hx, half_h, half_t))
    return out


def polygon_walls(points, half_h, half_t, kind='wall'):
    """Walls on the outside of a closed polygon (its inner faces run along the polygon)."""
    cx = sum(p[0] for p in points) / len(points)
    cz = sum(p[1] for p in points) / len(points)
    out = []
    for i, (x0, z0) in enumerate(points):
        x1, z1 = points[(i + 1) % len(points)]
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        nx, nz = -dz / length, dx / length
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        if nx * (mx - cx) + nz * (mz - cz) < 0:
            nx, nz = -nx, -nz
        out.append(box(kind, mx + nx * half_t, half_h, mz + nz * half_t, math.atan2(-dz, dx), length / 2 + 0.3, half_h, half_t))
    return out


def ramp(sx, sz, angle, length, height, half_w, kind='ramp', half_t=0.2):
    """A slab that starts on the ground at (sx, sz), runs `length` along direction `angle` and ends `height` up."""
    theta = math.asin(height / length)
    d = length / 2 * math.cos(theta) + half_t * math.sin(theta)
    return box(kind, sx + math.cos(angle) * d, height / 2 - half_t * math.cos(theta), sz + math.sin(angle) * d, -angle,
               length / 2, half_t, half_w, pitch=theta)


def container_block(cx, cz, along, count, rows, stack=1, tint=0):
    """`rows` rows of `count` shipping containers (6.1 x 2.4 m), side by side; `along` is 'x' or 'z'."""
    out = []
    yaw = 0.0 if along == 'x' else math.pi / 2
    hy = 1.3 * stack
    for r in range(rows):
        off = (r - (rows - 1) / 2) * 2.5
        for c in range(count):
            pos = (c - (count - 1) / 2) * 6.1
            x, z = (cx + pos, cz + off) if along == 'x' else (cx + off, cz + pos)
            out.append(box('container', x, hy, z, yaw, 3.0, hy, 1.2, tint=(tint + r + c) % 4))
    return out


def facing_centre_yaw(x, z):
    return r6(math.atan2(z, -x)) if (x or z) else 0.0


def pts(points):
    return [[r3(x), r3(z)] for x, z in points]


# ------------------------------------------------------------------ the arenas
def stadium():
    boxes = ring_walls(45, 32, 1.5, 1.0)
    for i in range(4):  # concrete blocks on a ring, offset so they never sit on a spawn line
        a = ((i + 0.25) / 4) * TAU
        boxes.append(box('block', math.cos(a) * 14, 0.75, math.sin(a) * 14, -a - math.pi / 2, 2.5, 0.75, 1.0))
    return {
        'id': 'stadium', 'name': 'Stadium',
        'groundHalfExtent': 120,
        'ground': {'friction': 1.0, 'grip': 1.0, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'circle', 'radius': 45},
        'spawn': {'kind': 'ring', 'radius': 32},
        'look': {'sky': '#0b1226', 'fog': '#0b1226', 'fogNear': 70, 'fogFar': 240, 'ground': '#6b4a2f', 'wall': '#8a8d91',
                 'block': '#9a9da1', 'sun': '#fff0d8', 'sunIntensity': 2.4, 'hemiSky': '#9db4ff', 'hemiGround': '#3b2c1c', 'marks': '#080604'},
    }


def ice():
    radius = 52
    boxes = ring_walls(radius, 40, 0.9, 1.5)
    for i in range(6):  # blocks of ice, a ring of them well inside the lake
        a = ((i + 0.5) / 6) * TAU
        boxes.append(box('ice', math.cos(a) * 21, 0.9, math.sin(a) * 21, -a - math.pi / 2 + 0.6, 2.4, 0.9, 2.4))
    return {
        'id': 'ice', 'name': 'Frozen Lake',
        'groundHalfExtent': 140,
        'ground': {'friction': 0.2, 'grip': 0.4, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'circle', 'radius': radius},
        'spawn': {'kind': 'ring', 'radius': 38},
        'look': {'sky': '#a9c7e8', 'fog': '#c9dcef', 'fogNear': 60, 'fogFar': 260, 'ground': '#dff0fb', 'wall': '#f4f9ff',
                 'block': '#9fd0f0', 'sun': '#fff2e0', 'sunIntensity': 2.2, 'hemiSky': '#cfe3ff', 'hemiGround': '#9fb8d0', 'marks': '#2a4a6a'},
    }


def quarry():
    a_axis, b_axis, n = 62.0, 42.0, 40
    outline = [(a_axis * math.cos(i / n * TAU), b_axis * math.sin(i / n * TAU)) for i in range(n)]
    boxes = polygon_walls(outline, 1.5, 1.0)
    height = 1.2
    boxes.append(box('block', 0, height / 2, 0, 0, 6, height / 2, 6))  # a raised mound with a ramp on each side
    for k in range(4):
        angle = k * math.pi / 2
        boxes.append(ramp(math.cos(angle) * 15.5, math.sin(angle) * 15.5, angle + math.pi, 9.5, height, 5.0))
    spawns = [(0.72 * a_axis * math.cos((k + 0.5) / 8 * TAU), 0.72 * b_axis * math.sin((k + 0.5) / 8 * TAU)) for k in range(8)]
    return {
        'id': 'quarry', 'name': 'Mud Quarry',
        'groundHalfExtent': 130,
        'ground': {'friction': 1.0, 'grip': 0.9, 'drag': 0.25, 'power': 0.88},
        'boxes': boxes,
        'bounds': {'kind': 'polygon', 'points': pts(outline)},
        'spawn': {'kind': 'points', 'points': pts(spawns)},
        'look': {'sky': '#d8a066', 'fog': '#c98f58', 'fogNear': 50, 'fogFar': 200, 'ground': '#8a5a32', 'wall': '#6e4a2c',
                 'block': '#7a5b3b', 'sun': '#ffcf99', 'sunIntensity': 2.6, 'hemiSky': '#ffd9a8', 'hemiGround': '#5a3a20', 'marks': '#2a1a0e'},
    }


def port():
    hx, hz = 45.0, 33.0
    outline = [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]
    boxes = polygon_walls(outline, 1.5, 1.0)
    boxes += container_block(-27, -20, 'x', 2, 2, tint=0)
    boxes += container_block(21, -26, 'z', 2, 2, tint=1)
    boxes += container_block(27, 20, 'x', 2, 2, tint=2)
    boxes += container_block(-21, 26, 'z', 2, 2, tint=3)
    boxes += [box('container', 0, 1.3, -27, 0, 3.0, 1.3, 1.2, tint=1), box('container', 0, 1.3, 27, 0, 3.0, 1.3, 1.2, tint=2),
              box('container', -38, 1.3, 0, math.pi / 2, 3.0, 1.3, 1.2, tint=3), box('container', 38, 1.3, 0, math.pi / 2, 3.0, 1.3, 1.2, tint=0)]
    boxes += [ramp(-15, 0, 0, 7, 1.0, 3.0), ramp(15, 0, math.pi, 7, 1.0, 3.0)]  # two kickers facing each other across the middle
    spawns = [(-12, -26), (12, -26), (38, -8), (38, 8), (12, 26), (-12, 26), (-38, 8), (-38, -8)]
    return {
        'id': 'port', 'name': 'Container Port',
        'groundHalfExtent': 120,
        'ground': {'friction': 1.0, 'grip': 1.15, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'polygon', 'points': pts(outline)},
        'spawn': {'kind': 'points', 'points': pts(spawns)},
        'look': {'sky': '#1a1f2e', 'fog': '#252a3a', 'fogNear': 60, 'fogFar': 220, 'ground': '#4a4d52', 'wall': '#6b6e73',
                 'block': '#7d8086', 'sun': '#ffb066', 'sunIntensity': 2.6, 'hemiSky': '#a3b2e0', 'hemiGround': '#33281f', 'marks': '#0a0a0a'},
    }


ARENAS = [stadium, ice, quarry, port]


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'arenas')
    os.makedirs(root, exist_ok=True)
    for build in ARENAS:
        arena = build()
        path = os.path.join(root, arena['id'] + '.json')
        with open(path, 'w') as f:
            json.dump(arena, f, indent=1)
            f.write('\n')
        print('wrote', os.path.normpath(path), len(arena['boxes']), 'boxes')


if __name__ == '__main__':
    main()

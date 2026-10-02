"""Turns the four car models of `art/cars/src` (exported from the Blender car scenes, about 10 000 triangles each) into the models the game
loads: the body panels that a dent can push around are given a vertex about every 0.35 m, so a dent bends them instead of tearing a few
long triangles, and the surface is shaded smooth with sharp creases kept. Everything else is left as modelled.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/cars/densify_cars.py
    CAR=sedan PREVIEW=<folder> ...    one car, and a picture of it per car in PREVIEW

Environment: CAR (sedan | coupe | wagon | pickup | all), OUT (default src/client/assets), SRC (default art/cars/src), PREVIEW (folder for
`car_<id>.png`; the menu shows them; default: next to the models), MAXLEN (longest edge left on a dentable panel, default 0.35 m).

The game relies on the node names: body, hood, trunk (not on the wagon or the pickup), door_L, door_R, bumper_F, bumper_R (+ `_rubber`),
wheel_FL/FR/RL/RR, and the one material named `paint*`, which is tinted with the player's colour.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.environ.get('SRC', os.path.join(HERE, 'src'))
OUT = os.environ.get('OUT', os.path.join(ROOT, 'src', 'client', 'assets'))
PREVIEW = os.environ.get('PREVIEW', OUT)
MAXLEN = float(os.environ.get('MAXLEN', '0.35'))
CARS = ['sedan', 'coupe', 'wagon', 'pickup']
# the panels that are long and flat enough to need more vertices; the rest of the car follows the dent by position
DENSIFY = ('body', 'hood', 'trunk', 'door_L', 'door_R', 'bumper_F', 'bumper_R', 'roof', 'bed', 'stripe_hood_1', 'stripe_hood_-1',
           'stripe_deck_1', 'stripe_deck_-1', 'stripe_roof_1', 'stripe_roof_-1')


def densify(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(5):
        long_edges = [e for e in bm.edges if e.calc_length() > MAXLEN]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def triangles(objects):
    total = 0
    for ob in objects:
        ob.data.calc_loop_triangles()
        total += len(ob.data.loop_triangles)
    return total


def build(car):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(SRC, f'derby_{car}_game.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    before = triangles(meshes)
    for ob in meshes:
        if ob.name in DENSIFY:
            densify(ob)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    after = triangles(meshes)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'car_{car}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False, export_image_format='AUTO')
    print(f'{car}: {before} -> {after} triangles, wrote {out} ({os.path.getsize(out) // 1024} KB)')
    render(car)


def render(car):
    """A three-quarter picture on a transparent ground, for the menu."""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = False
    scn.render.film_transparent = True
    scn.render.resolution_x, scn.render.resolution_y = 360, 200
    scn.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.85, 1.0, 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scn.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sob = bpy.data.objects.new('sun', sun)
    sob.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scn.collection.objects.link(sob)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 48
    cob = bpy.data.objects.new('cam', cam)
    scn.collection.objects.link(cob)
    scn.camera = cob
    pos = Vector((6.4, -5.6, 2.3))
    cob.location = pos
    cob.rotation_euler = (Vector((0, 0, 0.75)) - pos).to_track_quat('-Z', 'Y').to_euler()
    scn.render.filepath = os.path.join(PREVIEW, f'car_{car}.png')
    bpy.ops.render.render(write_still=True)


which = os.environ.get('CAR', 'all')
for name in (CARS if which == 'all' else [which]):
    build(name)

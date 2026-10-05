"""Re-export edited asset scenes from the current saved Blender kit."""
import bpy
import json
from pathlib import Path
import sys
from mathutils import Vector

BASE=Path(bpy.data.filepath).parent.parent
sys.path.insert(0,str(BASE/'blender'))
from gltf_cleanup import remove_unused_tangents
manifest=json.loads((BASE/'manifest.json').read_text())
manifest['coordinates']['glb']='Y up, +Z forward'
for a in manifest['assets']:
    if a.get('source')=='code/golf-cart.ts':continue
    scene=bpy.data.scenes['ASSET | '+a['id']]
    bpy.context.window.scene=scene
    scene.frame_set(1)
    scene.objects[a['id']]['forward']='-Y in Blender; +Z in glTF'
    original_name=scene.name
    a['animation']=('PracticeSwing' if a['id']=='golfer' else 'Walk') if a['animated'] else None
    if a['animated']: scene.name=a['animation']
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(BASE/a['file']),export_format='GLB',
        use_selection=True,use_active_scene=True,export_extras=True,
        export_animations=a['animated'],export_animation_mode='SCENE',
        export_anim_scene_split_object=False,export_frame_range=True,
        export_force_sampling=True,export_nla_strips_merged_animation_name=a['animation'] or 'Animation',
        export_cameras=False,export_lights=False,export_tangents=True,export_anim_slide_to_zero=True)
    remove_unused_tangents(BASE/a['file'])
    scene.name=original_name
    meshes=[o for o in scene.objects if o.type=='MESH']
    a['mesh_count']=len(meshes)
    a['triangles_source']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
    points=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
    a['bounds_blender']=[min(p[i] for p in points) for i in range(3)]+[max(p[i] for p in points) for i in range(3)]
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2))
source_name='build_realistic_assets.py' if (BASE/'blender'/'build_realistic_assets.py').exists() else 'build_assets.py'
source=bpy.data.texts.get(source_name) or bpy.data.texts.new(source_name)
source.from_string((BASE/'blender'/source_name).read_text(encoding='utf-8'))
source.filepath='//'+source_name
bpy.context.window.scene=next(scene for scene in bpy.data.scenes if scene.name.startswith('SHOWROOM |'))
bpy.ops.object.select_all(action='DESELECT')
if bpy.context.screen:
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
            area.spaces.active.overlay.show_overlays=False
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
(BASE/'EXPORT_COMPLETE.json').write_text(json.dumps({'status':'complete','isolated_scenes':len(manifest['assets'])}))

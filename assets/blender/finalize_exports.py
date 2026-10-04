"""Run in Blender UI after build_assets.py; exports isolated asset scenes."""
import bpy
import json
from pathlib import Path

BASE=Path(bpy.data.filepath).parent.parent
manifest=json.loads((BASE/'manifest.json').read_text())
manifest['coordinates']['glb']='Y up, +Z forward'
for a in manifest['assets']:
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
        export_cameras=False,export_lights=False)
    scene.name=original_name
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2))
source=bpy.data.texts.get('build_assets.py')
source.from_string((BASE/'blender'/'build_assets.py').read_text(encoding='utf-8'))
source.filepath='//build_assets.py'
bpy.context.window.scene=bpy.data.scenes['SHOWROOM | Golf Range Simulator']
bpy.context.window.workspace=bpy.data.workspaces['Layout']
bpy.ops.object.select_all(action='DESELECT')
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_perspective='CAMERA'
        area.spaces.active.shading.type='MATERIAL'
        area.spaces.active.overlay.show_overlays=False
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
(BASE/'EXPORT_COMPLETE.json').write_text(json.dumps({'status':'complete','isolated_scenes':len(manifest['assets'])}))

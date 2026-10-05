"""Reproducible realistic procedural asset kit. Blender 5.2, no external assets.

Run: blender --background --factory-startup --python assets/blender/build_realistic_assets.py
Metres, Blender Z up / -Y forward; glTF Y up / +Z forward.
Textures are generated and exported as embedded PNGs. Original generator remains
available for provenance, but this file creates the game's current 16 GLBs.
"""
import bpy
import math
import json
import random
import sys
import numpy as np
from pathlib import Path
from mathutils import Vector, Euler
from collections import defaultdict

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from gltf_cleanup import remove_unused_tangents
OUT = BASE / 'models'
TEX = BASE / 'textures'
PREVIEW = BASE / 'previews'
for folder in (OUT, TEX, PREVIEW): folder.mkdir(parents=True, exist_ok=True)
random.seed(811)
np.random.seed(811)
ASSETS, M = [], {}
CURRENT = ROOT = None
PRESERVE = {'Ground', 'Flag', 'Torso', 'LeftUpperArm', 'RightUpperArm'}


def image_texture(name, color, kind='grain', size=256, alpha=False):
    y, x = np.mgrid[0:size, 0:size].astype(float) / size
    noise = np.zeros((size, size))
    rng = np.random.default_rng(sum(map(ord, name)))
    for freq, amp in [(3,.24), (9,.13), (27,.07), (81,.045)]:
        phase = rng.random(4) * math.tau
        noise += amp * (np.sin((x*freq+y*freq*.23)*math.tau+phase[0]) *
                       np.sin((y*freq+x*freq*.19)*math.tau+phase[1]))
    noise += rng.random((size,size))*.08-.04
    if kind == 'wood':
        grain = np.sin(y * 160 + np.sin(x * 12) * 3 + noise * 9)
        noise = noise * .45 + grain * .075
    elif kind == 'bark':
        grain = np.sin(x * 170 + np.sin(y * 23) * 5 + noise * 3)
        noise += grain * .14
    elif kind == 'fur':
        noise = noise * .34 + np.sin(x * 170 + y * 8) * .02
    elif kind == 'knit':
        noise = np.sin(x*112*math.tau)*np.sin(y*126*math.tau)*.025 + rng.random((size,size))*.018-.009
    rgba = np.ones((size,size,4), dtype=np.float32)
    rgba[:,:,:3] = np.clip(np.array(color)[None,None,:] * (1+noise[:,:,None]),0,1)
    if alpha:
        # A twig spray: seven individually shaped leaves, translucent veins and
        # irregular margins, on a transparent background. Used as foliage cards.
        rgba[:,:,:3] = 0
        rgba[:,:,3] = 0
        leaves = [(.50,.76,.11,.23,-.1),(.32,.58,.11,.23,-.8),(.68,.56,.11,.23,.8),
                  (.25,.35,.10,.20,-.8),(.75,.34,.10,.20,.8),(.37,.19,.09,.18,-.6),(.62,.15,.09,.18,.6)]
        for cx,cy,rx,ry,a in leaves:
            dx=x-cx;dy=y-cy
            u=dx*math.cos(a)-dy*math.sin(a)
            v=dx*math.sin(a)+dy*math.cos(a)
            dist=(u/rx)**2+(v/ry)**2
            edge = 1 + .025*np.sin(v*180)
            mask=dist < edge
            shade=.74+.32*(1-dist)+noise*.25
            vein=np.exp(-np.abs(u)*180)*.24
            ribs=(np.cos((v+np.abs(u)*.6)*140) > .93)*.08
            for k,c in enumerate(color): rgba[:,:,k][mask]=np.clip(c*(shade+vein+ribs)[mask],0,1)
            rgba[:,:,3][mask]=1
        stem=(np.abs(x-.5-(y-.5)*.015)<.007)&(y<.77)&(y>.08)
        rgba[:,:,:3][stem]=(.15,.21,.045);rgba[:,:,3][stem]=1
        if 'pine' in name:
            # Scots pine needle spray: individual slender needles on a central
            # twig, rather than reusing the oak's broad leaf silhouette.
            rgba[:,:,:3]=0;rgba[:,:,3]=0
            # Multiple overlapping branchlets supply enough coverage to survive
            # distant minification. A single fishbone disappears in the game's
            # larger landscape; mature pines carry dense bunches of needles.
            for cx,start,height,lean in [(.23,.12,.65,.14),(.43,.06,.82,.03),(.61,.08,.77,-.02),(.78,.13,.63,-.14)]:
                for j in range(25):
                    for side in (-1,1):
                        cy=start+j*height/26;center=cx+(cy-start)*lean
                        reach=.19*(.70+.30*math.sin(j*.43))
                        ax=center;ay=cy;bx=center+side*reach;by=cy+.13
                        vx=bx-ax;vy=by-ay
                        t=np.clip(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1)
                        d=np.sqrt((x-ax-t*vx)**2+(y-ay-t*vy)**2)
                        mask=d<.013*(1-t*.72)
                        shade=.74+t*.40+noise*.25
                        for k,c in enumerate(color):rgba[:,:,k][mask]=c*shade[mask]
                        rgba[:,:,3][mask]=1
                stem=(np.abs(x-cx-(y-start)*lean)<.008)&(y>start-.03)&(y<start+height)
                rgba[:,:,:3][stem]=(.14,.16,.055);rgba[:,:,3][stem]=1
    image=bpy.data.images.new(name,size,size,alpha=True)
    image.pixels.foreach_set(rgba.flatten())
    image.filepath_raw=str(TEX/(name+'.png'));image.file_format='PNG';image.save()
    image.pack()
    return image


def material(name, color, rough=.7, metal=0, texture=None, alpha=False):
    m=bpy.data.materials.new('REAL_'+name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if texture:
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=texture
        m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
        if alpha:
            clip=m.node_tree.nodes.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=.45
            m.node_tree.links.new(node.outputs['Alpha'],clip.inputs[0])
            m.node_tree.links.new(clip.outputs[0],p.inputs['Alpha'])
            m.surface_render_method='DITHERED'
            m['gltf_alpha_mode']='MASK';m.alpha_threshold=.5
            m.use_backface_culling=False
        else:
            # Microstructure is subtle in Blender; exported textures remain true
            # glTF PBR base-colour images and receive game lighting normally.
            bump=m.node_tree.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value=.16;bump.inputs['Distance'].default_value=.008
            m.node_tree.links.new(node.outputs['Color'],bump.inputs['Height'])
            m.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    M[name]=m
    return m


def materials():
    palette={
      'orange':((.88,.245,.045),.3,.18),'orange_dark':((.48,.105,.025),.45,.15),
      'black':((.018,.024,.025),.5,0),'rubber':((.026,.03,.027),.88,0),
      'metal':((.11,.15,.16),.34,.85),'silver':((.51,.57,.58),.27,.9),
      'chrome':((.73,.77,.78),.16,1),'cream':((.81,.80,.69),.55,0),
      'white':((.90,.91,.86),.34,0),'red':((.70,.075,.045),.8,0),
      'yellow':((.92,.59,.08),.45,.1),'blue':((.08,.20,.23),.4,.3),
      'skin':((.58,.35,.22),.7,0),'skin_light':((.72,.49,.32),.67,0),
      'navy':((.045,.075,.095),.85,0),'glass':((.64,.73,.72),.14,.15),
      'fur_white':((.82,.78,.64),.93,0),'hoof':((.035,.03,.024),.52,0),
      'feather_dark':((.13,.12,.095),.92,0),'feather_light':((.35,.33,.26),.95,0),
      'goose_chest':((.52,.51,.42),.95,0), 'eye':((.012,.013,.01),.10,0),
      'sand':((.55,.47,.34),.95,0),'mat':((.065,.18,.075),1,0),
      'shirt':((.23,.34,.29),.92,0),'stitch':((.16,.22,.19),.9,0),
    }
    for name,(color,rough,metal) in palette.items():material(name,color,rough,metal)
    for name,color,kind in [
      ('wood',(.34,.22,.13),'wood'),('wood_light',(.49,.35,.21),'wood'),
      ('bark',(.20,.17,.125),'bark'),('concrete',(.38,.40,.37),'grain'),
      ('grass',(.19,.34,.13),'grain'),('grass_light',(.25,.40,.18),'grain'),
      ('grass_dark',(.105,.23,.07),'grain'),('fox',(.54,.225,.07),'fur'),
      ('deer',(.35,.24,.145),'fur'),('fur_cream',(.66,.56,.39),'fur'),
    ]:material(name,color,.95,texture=image_texture(name,color,kind))
    material('oak_leaves',(.2,.34,.065),.93,texture=image_texture('oak-leaf-spray',(.20,.35,.075),alpha=True),alpha=True)
    material('pine_leaves',(.085,.20,.08),.97,texture=image_texture('pine-needle-spray',(.10,.23,.095),size=512,alpha=True),alpha=True)


def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);CURRENT.collection.objects.link(o)
    o.parent=parent;o.location=loc;return o


def start(name,description,animated=False):
    global CURRENT,ROOT
    CURRENT=bpy.data.scenes.new('ASSET | '+name);bpy.context.window.scene=CURRENT
    CURRENT.unit_settings.system='METRIC';CURRENT.render.fps=24
    CURRENT.frame_start=1;CURRENT.frame_end=49
    ROOT=empty(name);ROOT['asset']=name;ROOT['units']='metres'
    ROOT['forward']='-Y in Blender; +Z in glTF';ROOT['description']=description
    ASSETS.append({'name':name,'description':description,'scene':CURRENT,'root':ROOT,'animated':animated})


def finish(o,name,mat,parent=None,smooth=False):
    o.name=name;o.parent=parent or ROOT
    if mat:o.data.materials.append(M[mat])
    if smooth:
        for p in o.data.polygons:p.use_smooth=True
    return o


def box(name,loc,size,mat,bevel=0,parent=None,rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=finish(bpy.context.object,name,mat,parent);o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Rolled edges','BEVEL');mod.width=bevel;mod.segments=3 if bevel>=.04 else (2 if bevel>=.012 else 1)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in o.data.polygons:p.use_smooth=True
        mod=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL')
        mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    o.rotation_euler=rot
    return o


def sphere(name,loc,size,mat,parent=None,segments=24,rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
    o=finish(bpy.context.object,name,mat,parent,True);o.scale=size;return o


def cylinder(name,loc,r,depth,mat,parent=None,vertices=24,rot=(0,0,0),r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=depth,location=loc)
    o=finish(bpy.context.object,name,mat,parent,True);o.rotation_euler=rot;return o


def beam(name,a,b,r,mat,parent=None,vertices=16,r2=None):
    d=Vector(b)-Vector(a)
    o=cylinder(name,(Vector(a)+Vector(b))/2,r,d.length,mat,parent,vertices,r2=r2)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o


def torus(name,loc,major,minor,mat,parent=None,rot=(0,0,0),segments=32,minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_segments=segments,minor_segments=minor_segments,major_radius=major,minor_radius=minor,location=loc,rotation=rot)
    return finish(bpy.context.object,name,mat,parent,True)


def mesh(name,verts,faces,mat,parent=None,smooth=False,uvs=None):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);CURRENT.collection.objects.link(o);finish(o,name,mat,parent,smooth)
    if uvs:
        layer=data.uv_layers.new(name='UVMap')
        for face in data.polygons:
            for i,index in enumerate(face.loop_indices):layer.data[index].uv=uvs[i%4]
    return o


def sweep(name,points,radii,mat,parent=None,sides=12):
    verts=[]
    for i,p in enumerate(points):
        p=Vector(p)
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        tangent.normalize()
        ref=Vector((1,0,0)) if abs(tangent.x)<.8 else Vector((0,1,0))
        u=tangent.cross(ref).normalized();v=tangent.cross(u).normalized()
        rad=radii[i];rx,ry=(rad,rad) if isinstance(rad,(float,int)) else rad
        for j in range(sides):
            a=j*math.tau/sides;verts.append(tuple(p+u*rx*math.cos(a)+v*ry*math.sin(a)))
    faces=[]
    for i in range(len(points)-1):
        for j in range(sides):faces.append((i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j))
    faces.append(tuple(reversed(range(sides))));faces.append(tuple((len(points)-1)*sides+j for j in range(sides)))
    o=mesh(name,verts,faces,mat,parent,True)
    # Tiled cylindrical UVs give bark/fur genuine surface grain.
    layer=o.data.uv_layers.new(name='UVMap')
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            vid=o.data.loops[li].vertex_index;layer.data[li].uv=((vid%sides)/sides,(vid//sides)/(len(points)-1))
    return o


def text(name,body,loc,size,mat,parent=None,rot=(math.pi/2,0,0)):
    data=bpy.data.curves.new(name,'FONT');data.body=body;data.align_x='CENTER';data.align_y='CENTER'
    data.size=size;data.extrude=.0007
    o=bpy.data.objects.new(name,data);CURRENT.collection.objects.link(o)
    o.parent=parent or ROOT;o.location=loc;o.rotation_euler=rot;data.materials.append(M[mat])
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');o.select_set(False);return o


def join_material_groups():
    groups=defaultdict(list)
    for o in list(CURRENT.objects):
        if o.type!='MESH' or o.name in PRESERVE or o.name.startswith('MowingStrip'):continue
        groups[(o.parent,o.data.materials[0] if o.data.materials else None)].append(o)
    for (parent,mat),objects in groups.items():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];name=objects[0].name
        bpy.ops.object.join();objects[0].name=name


def wheel(side,y,r,z):
    label=('Front' if y<0 else 'Rear')+('_L' if side<0 else '_R')
    steering=empty(label+'_Steer',(side*.78,y,z),ROOT)
    p=empty(label+'_Wheel',parent=steering)
    # Rounded radial tyre shoulder, a separate inset rim, lugged tread blocks.
    torus('RadialTyre',(0,0,0),r*.74,r*.27,'rubber',p,(0,math.pi/2,0),40)
    cylinder('Rim',(0,0,0),r*.57,.23,'cream',p,32,(0,math.pi/2,0))
    cylinder('RimInset',(side*.132,0,0),r*.44,.018,'metal',p,32,(0,math.pi/2,0))
    torus('RimBead',(side*.143,0,0),r*.48,.012,'silver',p,(0,math.pi/2,0))
    cylinder('Hub',(side*.149,0,0),r*.19,.06,'orange',p,24,(0,math.pi/2,0))
    for k in range(6):
        a=k*math.tau/6
        cylinder('WheelNut',(side*.187,math.sin(a)*r*.28,math.cos(a)*r*.28),.016,.026,'chrome',p,6,(0,math.pi/2,0))
    for k in range(26):
        a=k*math.tau/26
        for s in (-1,1):
            box('TreadLug',(s*.07,math.sin(a)*r,math.cos(a)*r),(.15,.073,.039),'rubber',.008,p,(-a,0,s*.31))
    return p


def tractor():
    start('tractor-picker','Commercial orange range picker: curved painted panels, treaded tyres, engine grille, metal basket, operator cockpit and disk collection head.')
    box('Chassis',(0,0,.53),(1.24,2.64,.24),'metal',.055)
    box('Hood',(0,-.76,1.05),(1.04,1.31,.63),'orange',.16)
    box('HoodPanel',(0,-.77,1.38),(.85,1.02,.025),'orange_dark',.055)
    box('Grille',(0,-1.412,1.05),(.83,.035,.38),'black',.025)
    for x in np.linspace(-.36,.36,12):box('GrilleSlat',(x,-1.441,1.045),(.016,.025,.31),'silver',.004)
    for s in (-1,1):
        box('HeadlampBezel',(s*.42,-1.385,1.30),(.16,.053,.108),'metal',.025)
        box('HeadlampLens',(s*.42,-1.416,1.30),(.131,.009,.073),'glass',.014)
        for k in range(4):box('LensRidge',(s*.42-.045+k*.03,-1.425,1.30),(.004,.003,.052),'silver',.001)
        for k in range(5):box('EngineSideVent',(s*.524,-.58+k*.067,1.12),(.007,.031,.18),'black',.006)
        beam('HoodSeam',(s*.37,-1.23,1.37),(s*.37,-.34,1.37),.004,'metal')
        wheel(s,-.83,.355,.375);wheel(s,.75,.475,.497)
        box('RearFender',(s*.73,.70,1.10),(.46,1.10,.09),'orange',.055)
        box('FenderEdge',(s*.94,.70,1.05),(.028,1.07,.12),'orange_dark',.015)
        box('Step',(s*.75,.0,.46),(.33,.38,.07),'metal',.014)
        for k in range(6):box('StepTread',(s*.75,-.15+k*.06,.502),(.27,.011,.008),'silver',.002)
        beam('Rollbar',(s*.54,.82,.88),(s*.54,.82,2.01),.035,'metal')
        box('Mirror',(s*.62,-.24,1.62),(.11,.06,.17),'metal',.015)
        box('MirrorFace',(s*.62,-.205,1.62),(.083,.01,.13),'chrome',.008)
        beam('MirrorArm',(s*.49,-.03,1.45),(s*.62,-.25,1.62),.012,'metal')
        box('TailLight',(s*.75,1.265,1.15),(.11,.035,.07),'red',.012)
    box('FrontBumper',(0,-1.49,.64),(1.31,.14,.14),'metal',.04)
    for s in (-1,1):cylinder('TowEye',(s*.35,-1.58,.65),.055,.023,'silver',vertices=20,rot=(math.pi/2,0,0))
    sweep('Exhaust',[(.40,-.40,.93),(.40,-.40,1.67),(.40,-.47,1.81),(.40,-.57,1.83)],[.045,.045,.042,.04],'metal')
    cylinder('ExhaustHeatShield',(.40,-.40,1.30),.067,.36,'silver',vertices=24)
    for z in (1.18,1.23,1.28,1.33,1.38,1.43):torus('ShieldRing',(.40,-.40,z),.068,.006,'metal')
    box('Footwell',(0,.21,.735),(.77,.84,.058),'black',.022)
    box('SeatBase',(0,.34,.97),(.46,.49,.14),'black',.065)
    box('SeatBack',(0,.56,1.20),(.46,.135,.44),'black',.065,rot=(.14,0,0))
    for x in (-.11,0,.11):beam('SeatStitch',(x,.493,1.03),(x,.535,1.36),.003,'metal')
    cylinder('SeatPedestal',(0,.36,.82),.08,.20,'metal')
    beam('SteeringColumn',(0,-.08,.79),(0,-.17,1.28),.023,'metal')
    torus('SteeringWheel',(0,-.17,1.28),.176,.019,'black',rot=(.33,0,0))
    for a in (0,math.tau/3,math.tau*2/3):beam('WheelSpoke',(0,-.17,1.28),(.15*math.cos(a),-.17+.14*math.sin(a),1.28+.05*math.sin(a)),.009,'metal')
    box('Dashboard',(0,-.29,1.07),(.52,.20,.14),'black',.027,rot=(.2,0,0))
    for x in (-.11,.11):cylinder('Gauge',(x,-.205,1.16),.055,.018,'silver',vertices=24,rot=(.35,0,0))
    for x in (-.16,.16):box('Pedal',(x,-.05,.785),(.09,.14,.016),'metal',.006)
    beam('GearLever',(.25,.20,.75),(.27,.23,1.05),.011,'silver')
    sphere('GearKnob',(.27,.23,1.055),(.024,.024,.028),'black',segments=16,rings=10)
    box('Canopy',(0,.25,2.035),(1.43,1.55,.095),'cream',.06)
    box('CanopyTrim',(0,.25,1.995),(1.43,1.55,.023),'metal',.055)
    beam('CanopyCrossbar',(-.54,.82,1.98),(.54,.82,1.98),.029,'metal')
    cylinder('BeaconBase',(0,.70,2.105),.076,.04,'black')
    cylinder('Beacon',(0,.70,2.17),.064,.12,'yellow',vertices=24)
    sphere('BeaconDome',(0,.70,2.23),(.064,.064,.029),'yellow',segments=20,rings=8)
    # Hopper is an open perforated cage: solid narrow rim, dense metal mesh and
    # floor beneath the runtime fill anchor, without an opaque top.
    box('HopperFloor',(0,1.30,.71),(1.40,.77,.055),'metal',.025)
    for x in (-.71,.71):
        box('HopperRim',(x,1.30,1.20),(.042,.86,.04),'orange',.012)
        for y in np.linspace(.89,1.71,14):beam('BasketWire',(x,y,.75),(x,y,1.18),.006,'silver',vertices=8)
        for z in (.80,.88,.96,1.04,1.12):beam('BasketWire',(x,.89,z),(x,1.71,z),.006,'silver',vertices=8)
    for y in (.88,1.72):
        box('HopperRim',(0,y,1.20),(1.45,.042,.04),'orange',.012)
        for x in np.linspace(-.70,.70,21):beam('BasketWire',(x,y,.75),(x,y,1.18),.006,'silver',vertices=8)
        for z in (.80,.88,.96,1.04,1.12):beam('BasketWire',(-.7,y,z),(.7,y,z),.006,'silver',vertices=8)
    empty('HopperFillAnchor',(0,1.27,.77),ROOT)['capacity_hint']=100
    for s in (-1,1):
        beam('PickerTow',(s*.43,-1.24,.48),(s*1.02,-1.95,.27),.036,'metal')
        beam('HydraulicRam',(s*.28,-1.1,.56),(s*.72,-1.78,.40),.023,'silver')
        sphere('TowJoint',(s*.43,-1.24,.48),(.064,.055,.055),'metal',segments=16,rings=10)
    box('PickerCrossbar',(0,-1.93,.37),(2.92,.105,.11),'orange',.035)
    collector=empty('CollectorRoller',(0,-2.04,.22),ROOT)
    cylinder('CollectorAxle',(0,0,0),.031,2.85,'silver',collector,24,(0,math.pi/2,0))
    for x in np.linspace(-1.36,1.36,34):
        cylinder('PickupDisk',(x,0,0),.198,.018,'rubber',collector,32,(0,math.pi/2,0))
        torus('DiskShoulder',(x,0,0),.17,.024,'rubber',collector,(0,math.pi/2,0),20,4)
    for x in (-1.49,1.49):
        cylinder('CollectorGuideWheel',(x,-2.04,.2),.194,.08,'orange',vertices=32,rot=(0,math.pi/2,0))
        cylinder('GuideHub',(x+(.045 if x>0 else -.045),-2.04,.2),.07,.02,'silver',vertices=20,rot=(0,math.pi/2,0))
    empty('CollectionZone',(0,-2.04,.10),ROOT)['width_metres']=2.85
    text('EngineBadge','RANGE 400',(0,-1.439,1.06),.086,'white')
    join_material_groups()


def props():
    start('golf-ball','Regulation 42.67 mm golf ball, smooth white urethane surface with baked dimple normal texture.')
    o=sphere('Ball',(0,0,.021335),(.021335,)*3,'white',segments=24,rings=16)
    # Equirectangular dimple normals: UV-compatible, embedded and exportable.
    size=256;y,x=np.mgrid[0:size,0:size]/size
    lon=x*math.tau;lat=y*math.pi
    spacing=.178
    u=(lon*np.maximum(.16,np.sin(lat))/spacing)%1;v=(lat/spacing)%1
    dx=u-.5;dy=v-.5;r=np.sqrt(dx*dx+dy*dy)
    mask=r<.40;strength=np.where(mask,np.sin(np.clip(r/.4,0,1)*math.pi)*.46,0)
    data=np.ones((size,size,4),dtype=np.float32)
    data[:,:,0]=.5+dx/np.maximum(r,.001)*strength*.5
    data[:,:,1]=.5+dy/np.maximum(r,.001)*strength*.5
    data[:,:,2]=np.sqrt(np.maximum(0,1-strength*strength))*.5+.5
    normal=bpy.data.images.new('golf-ball-dimple-normal',size,size);normal.pixels.foreach_set(data.flatten())
    normal.colorspace_settings.name='Non-Color';normal.filepath_raw=str(TEX/'golf-ball-dimple-normal.png');normal.file_format='PNG';normal.save();normal.pack()
    ballmat=M['white'].copy();ballmat.name='REAL_GolfBall';o.data.materials[0]=ballmat
    node=ballmat.node_tree.nodes.new('ShaderNodeTexImage');node.image=normal
    n=ballmat.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.46
    ballmat.node_tree.links.new(node.outputs['Color'],n.inputs['Color']);ballmat.node_tree.links.new(n.outputs['Normal'],ballmat.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    start('target-flag','Wind-formed textile target flag, fibreglass pin and dark lined cup.')
    cylinder('Cup',(0,0,.008),.058,.016,'black',vertices=24)
    torus('CupRim',(0,0,.018),.056,.004,'silver',segments=24)
    cylinder('Pole',(0,0,1.05),.011,2.10,'cream',vertices=16)
    verts=[];faces=[]
    for row in range(5):
        for col in range(11):
            u=col/10;v=row/4
            verts.append((u*.63,math.sin(u*10-v*.7)*u*.035,2.065-v*.35-u*.036))
    for row in range(4):
        for col in range(10):
            a=row*11+col;faces.append((a,a+1,a+12,a+11))
    mesh('Flag',verts,faces,'red',smooth=True)
    for z in (1.72,2.06):torus('FlagEyelet',(0,0,z),.014,.003,'silver',rot=(math.pi/2,0,0),segments=16)
    join_material_groups()
    for distance,col in [(50,'red'),(100,'blue'),(150,'yellow')]:
        start('distance-marker-'+str(distance),'Painted aluminium '+str(distance)+' yard marker with inset face, timber supports and bolts.')
        for x in (-.42,.42):
            box('Post',(x,.025,.46),(.075,.075,.92),'wood',.01)
            box('PostFoot',(x,.025,.035),(.10,.10,.07),'metal',.012)
        box('MarkerFrame',(0,0,1.02),(1.32,.075,.66),'metal',.033)
        box('MarkerFace',(0,-.042,1.02),(1.24,.025,.58),col,.019)
        text('Yardage',str(distance),(0,-.058,1.078),.32,'white')
        text('Unit','YARDS',(0,-.059,.843),.09,'white')
        for x in (-.58,.58):
            for z in (.80,1.25):cylinder('FaceRivet',(x,-.061,z),.013,.012,'silver',vertices=8,rot=(math.pi/2,0,0))
        join_material_groups()
    start('fence-section','Three metre weathered split rail boundary fence with natural wood grain and dark steel fasteners.')
    for x in (-1.45,1.45):
        box('FencePost',(x,0,.60),(.15,.15,1.20),'wood',.012)
        box('PostCap',(x,0,1.205),(.18,.18,.048),'wood_light',.012)
        for z in (.39,.86):
            cylinder('RailBolt',(x,-.061,z),.015,.018,'metal',vertices=8,rot=(math.pi/2,0,0))
    for z in (.39,.86):box('FenceRail',(0,-.008,z),(3.0,.09,.12),'wood_light',.012)
    join_material_groups()
    trees()
    start('range-ground','60 x 90 metre grass module, muted alternating mowing bands and organic target greens.')
    box('Ground',(0,0,-.13),(60,90,.25),'grass')
    for i in range(12):box('MowingStrip' if i==0 else 'MowingStrip.'+str(i).zfill(3),(-27.5+i*5,0,.002),(5,90,.008),'grass_light' if i%2 else 'grass')
    for x,y,r in [(-13,-9,4),(9,-22,4.7),(-7,-35,5.5)]:
        cylinder('TargetGreen',(x,y,.014),r,.025,'grass_dark',vertices=48)
        cylinder('TargetInner',(x,y,.03),r*.78,.008,'grass',vertices=48)
    join_material_groups()


def foliage_cards(name,cards,mat):
    verts=[];faces=[]
    for loc,width,height,a,tilt in cards:
        p=Vector(loc);u=Vector((math.cos(a),math.sin(a),0))*width*.5
        v=Vector((-math.sin(a)*math.sin(tilt),math.cos(a)*math.sin(tilt),math.cos(tilt)))*height*.5
        index=len(verts)
        verts.extend([tuple(p-u-v),tuple(p+u-v),tuple(p+u+v),tuple(p-u+v)])
        faces.append(tuple(index+j for j in range(4)))
    return mesh(name,verts,faces,mat,smooth=False,uvs=[(0,0),(1,0),(1,1),(0,1)])


def trees():
    start('tree-pine','Natural Scots pine: tapered bark trunk, irregular radial branches and cutout needle sprays, two material groups for instancing.')
    sweep('Trunk',[(0,0,0),(.035,-.015,1.0),(.015,.01,2.1),(.025,0,3.17)],[.115,.089,.051,.012],'bark',sides=10)
    cards=[]
    for tier in range(9):
        z=.68+tier*.265;reach=1.04*(1-tier/11)
        for k in range(6):
            a=k*math.tau/6+tier*.9+random.uniform(-.13,.13)
            end=(math.cos(a)*reach,math.sin(a)*reach,z+.12)
            sweep('Branch',[(.02,0,z),(end[0]*.58,end[1]*.58,z+.045),end],[.024,.014,.003],'bark',sides=6)
            for j in range(16):
                t=.16+(j%8)*.115
                pos=(end[0]*t+random.uniform(-.13,.13),end[1]*t+random.uniform(-.13,.13),z+.13+random.uniform(-.12,.12))
                cards.append((pos,.46*(1-tier*.028),.56,a+random.uniform(-1.7,1.7),random.uniform(.45,1.8)))
    foliage_cards('NeedleSprays',cards,'pine_leaves');join_material_groups()
    start('tree-broadleaf','Natural oak: irregular trunk and branching, open crown of textured cutout leaf sprays, two material groups for instancing.')
    sweep('Trunk',[(0,0,0),(.025,0,.68),(-.02,.04,1.28),(.055,.05,1.95)],[.135,.111,.091,.04],'bark',sides=10)
    centers=[]
    for i in range(9):
        a=i*2.399;reach=.47+random.random()*.30
        z=1.75+random.random()*.75
        p=(math.cos(a)*reach,math.sin(a)*reach,z)
        centers.append(p)
        sweep('Bough',[(0,0,1.05+random.random()*.4),(p[0]*.45,p[1]*.45,z-.3),p],[.057,.028,.008],'bark',sides=7)
        for j in range(3):
            q=(p[0]+random.uniform(-.25,.25),p[1]+random.uniform(-.25,.25),p[2]+random.uniform(.12,.38))
            beam('Twig',p,q,.008,'bark',vertices=6,r2=.002)
    centers.append((0,0,2.45));cards=[]
    for center in centers:
        for j in range(45):
            # Stratified spherical canopy, with gaps around boughs. The leaf
            # silhouettes live in alpha textures rather than opaque blobs.
            a=j*2.399+random.random()*.3
            c=1-2*(j+.5)/45;radius=.60*(.60+random.random()*.4)
            planar=math.sqrt(1-c*c)
            pos=(center[0]+math.cos(a)*planar*radius,center[1]+math.sin(a)*planar*radius,center[2]+c*radius*.75)
            cards.append((pos,.40+random.random()*.17,.45+random.random()*.14,a,random.uniform(.25,2.9)))
    foliage_cards('LeafSprays',cards,'oak_leaves');join_material_groups()


def depot():
    start('ball-depot','Architectural ball return: timber canopy, standing seam roof, stainless receiving chute, industrial storage bin and concrete unloading apron.')
    box('UnloadPad',(0,-1.1,.045),(4.4,3.9,.09),'concrete',.055)
    for x in (-1.94,1.94):box('PadStripe',(x,-1.55,.094),(.075,2.52,.009),'yellow')
    box('StopStripe',(0,-.30,.094),(3.86,.075,.009),'yellow')
    for x in (-1.70,1.70):
        box('CanopyPost',(x,.50,1.29),(.15,.15,2.54),'wood',.014)
        box('PostBracket',(x,.50,.14),(.19,.19,.23),'metal',.01)
        beam('DiagonalBrace',(x,.50,2.05),(x*.64,.50,2.60),.046,'wood_light',vertices=8)
        for z in (.15,.24):cylinder('BracketBolt',(x,.395,z),.017,.022,'silver',vertices=8,rot=(math.pi/2,0,0))
    box('Header',(0,.50,2.54),(3.60,.17,.20),'wood_light',.018)
    roof=[(-2,-.42,2.57),(2,-.42,2.57),(-2,1.95,2.57),(2,1.95,2.57),(-2,.75,2.98),(2,.75,2.98)]
    mesh('StandingSeamRoof',roof,[(0,1,5,4),(4,5,3,2),(0,4,2),(1,3,5)],'metal')
    for x in np.linspace(-1.94,1.94,15):
        beam('RoofSeam',(x,-.42,2.58),(x,.75,2.99),.009,'silver',vertices=8)
        beam('RoofSeam',(x,.75,2.99),(x,1.95,2.58),.009,'silver',vertices=8)
    for y in (-.43,1.96):beam('Gutter',(-2.02,y,2.57),(2.02,y,2.57),.036,'metal')
    beam('Drainpipe',(1.87,1.94,2.55),(1.87,1.94,.15),.025,'metal')
    box('StorageBody',(0,1.05,.73),(2.95,1.40,1.36),'blue',.065)
    box('BinLip',(0,1.05,1.43),(3.02,1.47,.08),'silver',.035)
    box('BinTop',(0,1.05,1.475),(2.80,1.18,.025),'black',.008)
    for x in (-1.46,1.46):
        for y in (.39,1.71):box('BinReinforcement',(x,y,.72),(.045,.04,1.22),'metal',.007)
    for x in (-.9,0,.9):box('InspectionDoor',(x,.336,.82),(.72,.018,.87),'blue',.025)
    for x in (-.9,0,.9):box('DoorHandle',(x+.22,.308,.93),(.018,.034,.16),'silver',.006)
    box('ChuteFloor',(0,-.16,.93),(1.25,1.03,.035),'silver',.012,rot=(-.30,0,0))
    for x in (-.65,.65):box('ChuteWall',(x,-.16,1.065),(.025,1.05,.26),'silver',.012,rot=(-.30,0,0))
    for x in (-.62,.62):beam('ChuteLip',(x,-.66,.985),(x,.32,1.30),.012,'chrome')
    box('Sign',(0,-.39,2.30),(2.67,.065,.36),'cream',.025)
    text('SignText','BALL RETURN',(0,-.426,2.30),.215,'navy')
    text('PadText','UNLOAD',(0,-1.67,.101),.40,'cream',rot=(0,0,0))
    empty('UnloadZone',(0,-1.3,.12),ROOT)['size_metres']=[3.7,2.8]
    empty('BallReturnAnchor',(0,-.25,1.06),ROOT);join_material_groups()


def bay():
    start('hitting-bay','Modern covered golf bay: exposed timber rafters, dark standing seam roof, steel partitions, textured tee mat, polished dispenser and tray.')
    box('Deck',(0,0,.08),(3,2.60,.16),'concrete',.035)
    box('MatEdge',(0,-.37,.157),(1.65,1.70,.046),'rubber',.02)
    box('TeeMat',(0,-.37,.18),(1.55,1.60,.05),'mat',.025)
    box('HittingStrip',(-.48,-.37,.21),(.28,1.5,.008),'grass_dark',.008)
    cylinder('Tee',(-.46,-.73,.25),.012,.12,'cream',vertices=16)
    for s in (-1,1):
        x=s*1.37
        box('RoofPost',(x,.98,1.42),(.12,.12,2.65),'wood',.014)
        box('PostShoe',(x,.98,.21),(.16,.16,.25),'metal',.012)
        box('DividerFrame',(x,-.07,.57),(.06,1.77,.91),'metal',.013)
        box('DividerInfill',(x,-.07,.55),(.062,1.64,.76),'blue',.012)
        beam('DividerRail',(x,-.92,1.04),(x,.81,1.04),.029,'silver')
        for k in range(8):box('DividerFlute',(x-s*.039,-.76+k*.19,.54),(.008,.027,.67),'metal',.004)
        box('Rafter',(x,.04,2.73),(.095,2.92,.14),'wood_light',.012,rot=(-.05,0,0))
        beam('RoofBrace',(x,.97,2.21),(x,.48,2.72),.03,'wood_light',vertices=8)
    box('Roof',(0,.02,2.82),(3.2,2.95,.095),'metal',.025,rot=(-.05,0,0))
    for x in np.linspace(-1.54,1.54,13):beam('RoofSeam',(x,-1.45,2.94),(x,1.48,2.79),.006,'silver',vertices=8)
    for y in (-.87,.04,.94):box('CrossRafter',(0,y,2.73-y*.05),(2.86,.075,.11),'wood_light',.01)
    beam('Gutter',(-1.61,-1.44,2.88),(1.61,-1.44,2.88),.027,'metal')
    box('LightBar',(0,.48,2.64),(.76,.13,.04),'black',.012)
    box('LightDiffuser',(0,.48,2.61),(.67,.10,.012),'white',.008)
    box('Dispenser',(1,.82,.65),(.46,.44,1.12),'silver',.07)
    box('DispenserFace',(1,.586,.77),(.36,.025,.61),'blue',.03)
    box('DispenseSlot',(1,.563,.47),(.29,.028,.12),'black',.015)
    cylinder('ControlButton',(1,.56,.86),.028,.018,'orange',vertices=24,rot=(math.pi/2,0,0))
    text('MachineLabel','RANGE',(1,.563,1.03),.075,'white')
    box('BallTray',(.94,.15,.23),(.40,.73,.07),'metal',.024)
    for x in (.75,1.13):box('TrayLip',(x,.15,.29),(.014,.73,.08),'silver',.004)
    for i in range(12):sphere('TrayBall',(.84+(i%3)*.085,-.1+(i//3)*.12,.29),(.023,)*3,'white',segments=12,rings=8)
    empty('BallLaunchAnchor',(-.46,-.73,.31),ROOT);join_material_groups()


def walk(pivots,amplitude=.3):
    for p,phase in pivots:
        for f in range(1,50,4):
            p.rotation_euler.x=math.sin((f-1)/48*math.tau+phase)*amplitude
            p.keyframe_insert(data_path='rotation_euler',frame=f)
        p.rotation_euler.x=math.sin(phase)*amplitude;p.keyframe_insert(data_path='rotation_euler',frame=49)
        p.animation_data.action.name='Walk__'+p.name


def eye_pair(y,z,x,parent=None,r=.012):
    for s in (-1,1):
        sphere('AnimalEye',(s*x,y,z),(r,r*.70,r),'eye',parent,segments=16,rings=10)
        sphere('EyeCatchlight',(s*x,y-r*.5,z+r*.25),(r*.2,)*3,'white',parent,segments=8,rings=6)


def goose():
    start('goose','Anatomically proportioned Canada goose with curved neck, cheek patches, layered feather detail, webbed feet and walking animation.',True)
    body=empty('GooseBody',parent=ROOT)
    sphere('GooseTorso',(0,.07,.42),(.20,.34,.23),'goose_chest',body)
    sphere('Breast',(0,-.16,.47),(.17,.18,.20),'fur_cream',body)
    sweep('Neck',[(0,-.19,.50),(0,-.25,.64),(0,-.30,.83),(0,-.34,.91)],[.068,.052,.049,.055],'black',body,sides=16)
    sphere('Head',(0,-.36,.93),(.077,.11,.084),'black',body)
    for s in (-1,1):
        sphere('CheekPatch',(s*.068,-.384,.90),(.013,.065,.035),'white',body,segments=20,rings=12)
        sphere('Wing',(s*.171,.075,.46),(.055,.295,.15),'feather_dark',body)
        for row in range(3):
            for k in range(7):
                o=sphere('ContourFeather',(s*(.185+row*.008),-.105+k*.047,.48-row*.045),(.029,.095,.014),'feather_light',body,segments=12,rings=8)
                o.rotation_euler.x=-.20;o.rotation_euler.z=s*.12
        for k in range(6):
            sphere('FlightFeather',(s*(.09+k*.023),.285,.425),(.022,.16,.016),'feather_dark',body,segments=12,rings=8)
    sweep('Beak',[(0,-.446,.934),(0,-.501,.927),(0,-.551,.92)],[.034,.028,.011],'black',body,sides=12)
    eye_pair(-.415,.956,.067,body,.008)
    sphere('Tail',(0,.375,.42),(.115,.17,.049),'feather_dark',body,segments=16,rings=10)
    legs=[]
    for s in (-1,1):
        p=empty('GooseLeg'+str(s),(s*.085,.05,.275),ROOT)
        sweep('GooseLegMesh',[(0,0,0),(0,.012,-.11),(0,-.005,-.23)],[.023,.016,.014],'hoof',p,sides=10)
        mesh('WebbedFoot',[(-.05,-.105,-.253),(-.018,-.12,-.253),(0,-.085,-.253),(.020,-.122,-.253),(.055,-.10,-.253),(.014,.045,-.249),(-.019,.045,-.249)],[(0,1,2,3,4,5,6)],'hoof',p)
        for x in (-.042,0,.042):beam('Toe',(0,.01,-.25),(x,-.104,-.25),.005,'hoof',p,8)
        legs.append((p,0 if s<0 else math.pi))
    walk(legs,.22)
    for f,z in [(1,0),(13,.012),(25,0),(37,.012),(49,0)]:body.location.z=z;body.keyframe_insert(data_path='location',frame=f)
    join_material_groups()


def organic_merge(objects,name,voxel=.026):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();o=objects[0];o.name=name
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Organic surface union','REMESH');mod.mode='VOXEL';mod.voxel_size=voxel
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=o.modifiers.new('Anatomical smoothing','SMOOTH');mod.factor=.85;mod.iterations=4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=o.modifiers.new('Game topology reduction','DECIMATE');mod.ratio=.34
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons:p.use_smooth=True
    # Blender voxel remesh removes UVs. Restore a generated spherical projection.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
    return o


def quadruped(kind):
    fox=kind=='fox'
    start(kind,('Natural red fox with tapered muzzle, dark stockings, thick brush tail and cream bib' if fox else 'Natural white tailed buck with long slender legs, tapered head, branching antlers and pale chest')+', with walking animation.',True)
    col='fox' if fox else 'deer';z=.49 if fox else .97;body=empty(kind.title()+'Body',parent=ROOT)
    if fox:
        pieces=[sphere('Body',(0,.055,z),(.145,.38,.17),col,body),sphere('Shoulder',(0,-.21,.51),(.139,.18,.19),col,body),
                sphere('Rump',(0,.28,.49),(.15,.18,.185),col,body),sphere('Neck',(0,-.33,.61),(.11,.14,.17),col,body),
                sphere('Head',(0,-.46,.68),(.12,.166,.125),col,body),sphere('Muzzle',(0,-.615,.644),(.073,.12,.061),col,body)]
        organic_merge(pieces,'FoxAnatomy',.022)
        sphere('Bib',(0,-.325,.497),(.105,.07,.147),'fur_cream',body)
        sphere('LowerJaw',(0,-.60,.610),(.062,.116,.031),'fur_cream',body)
        sphere('Nose',(0,-.719,.65),(.034,.029,.024),'eye',body,segments=16,rings=10)
        for s in (-1,1):
            ear=[(s*.057,-.49,.762),(s*.15,-.427,.78),(s*.105,-.423,.957),(s*.064,-.379,.75)]
            mesh('OuterEar',ear,[(0,1,2),(1,3,2),(3,0,2),(0,3,1)],col,body,True)
            mesh('InnerEar',[(s*.072,-.482,.795),(s*.132,-.434,.81),(s*.105,-.428,.916)],[(0,1,2)],'feather_dark',body,True)
        eye_pair(-.555,.724,.100,body,.014)
        sweep('BrushTail',[(0,.29,.50),(.015,.52,.43),(.04,.77,.34),(.08,.94,.32)],[.095,.125,.098,.065],col,body,sides=16)
        sweep('TailTip',[(.06,.84,.325),(.09,1.025,.34),(.09,1.09,.35)],[.085,.049,.003],'fur_white',body,sides=16)
    else:
        pieces=[sphere('Body',(0,.035,z),(.185,.49,.25),col,body),sphere('Shoulder',(0,-.30,.98),(.167,.21,.285),col,body),
                sphere('Rump',(0,.36,.95),(.191,.23,.267),col,body),sphere('Neck',(0,-.40,1.27),(.104,.145,.29),col,body),
                sphere('Head',(0,-.54,1.57),(.108,.185,.133),col,body),sphere('Muzzle',(0,-.705,1.52),(.071,.115,.078),col,body)]
        organic_merge(pieces,'DeerAnatomy',.027)
        sphere('ChestBib',(0,-.478,1.16),(.074,.045,.18),'fur_cream',body)
        sphere('LowerJaw',(0,-.666,1.47),(.070,.105,.031),'fur_cream',body)
        sphere('Nose',(0,-.803,1.534),(.056,.028,.029),'eye',body,segments=20,rings=12)
        for s in (-1,1):
            o=sphere('OuterEar',(s*.177,-.46,1.70),(.139,.041,.069),col,body);o.rotation_euler.y=s*-.50
            o=sphere('InnerEar',(s*.182,-.486,1.706),(.109,.01,.045),'fur_cream',body);o.rotation_euler.y=s*-.50
            points=[(s*.060,-.44,1.67),(s*.10,-.405,1.84),(s*.17,-.38,2.04),(s*.25,-.34,2.16)]
            sweep('AntlerBeam',points,[.024,.021,.016,.002],'wood_light',body,sides=10)
            for a,b,c in [((s*.085,-.414,1.80),(s*.10,-.54,1.91),(s*.12,-.55,2.00)),((s*.125,-.392,1.92),(s*.27,-.40,2.02),(s*.30,-.41,2.11))]:
                sweep('AntlerTine',[a,b,c],[.015,.010,.002],'wood_light',body,sides=8)
        eye_pair(-.629,1.619,.094,body,.013)
        sphere('RumpPatch',(0,.535,1.055),(.114,.032,.135),'fur_white',body)
        o=sphere('Tail',(0,.56,1.08),(.059,.112,.091),col,body);o.rotation_euler.x=-.45
    legs=[]
    for s in (-1,1):
        for rear in (False,True):
            y=(.26 if rear else -.25) if fox else (.34 if rear else -.33)
            hip=z-.06;p=empty(kind.title()+('Rear' if rear else 'Front')+('L' if s<0 else 'R'),(s*(.102 if fox else .151),y,hip),ROOT)
            if rear:
                points=[(0,0,0),(0,.065,-hip*.37),(0,.025,-hip*.58),(0,-.034,-hip+.057)]
            else:points=[(0,0,0),(0,-.005,-hip*.45),(0,.0,-hip*.67),(0,-.016,-hip+.057)]
            radii=[.044,.029,.019,.016] if fox else [.064,.035,.026,.019]
            sweep('Leg',points,radii,col,p,sides=12)
            if fox:sweep('Stocking',[points[-2],points[-1]],[.022,.019],'feather_dark',p,sides=12)
            sphere('Paw' if fox else 'Hoof',(0,-.035,-hip+.034),(.035 if fox else .037,.057,.031),'hoof',p,segments=16,rings=10)
            if not fox:beam('HoofSplit',(0,-.091,-hip+.026),(0,-.05,-hip+.058),.003,'black',p,8)
            legs.append((p,0 if (s<0)==rear else math.pi))
    walk(legs,.32 if fox else .22);join_material_groups()


def golfer():
    start('golfer','Right handed adult golfer in an athletic address stance, fitted knit polo, articulated legs and arms, wrist release and full shoulder high swing toward local +X.',True)
    CURRENT.frame_end=73
    contract={'duration_seconds':3.0,'impact_seconds':34/24,'impact_frame':35,'fps':24,
              'address_club_head_glb':[0,.1391304347826087,.71],'target_local_axis':'+X','handedness':'right',
              'walking_pivots':['LeftHip','RightHip','LeftKnee','RightKnee','LeftShoulder','RightShoulder']}
    ROOT['animation_contract']=contract;ASSETS[-1]['animation_contract']=contract
    ROOT['description']='Right handed: backswing local -X, through local +X. Frame35 is impact; 3 second clip.'
    cloth=image_texture('polo-knit',(.71,.76,.72),'knit',size=256)
    material('shirt',(.27,.35,.29),.88,texture=cloth)
    torso_rig=empty('TorsoPivot',parent=ROOT)
    pelvis=empty('PelvisPivot',parent=ROOT)
    sphere('Pelvis',(0,0,0),(.174,.119,.11),'navy',pelvis)
    sweep('Torso',[(0,0,0),(0,-.035,.13),(0,-.07,.29),(0,-.085,.40),(0,-.085,.43),(0,-.088,.47),(0,-.088,.49)],
          [(.108,.16),(.11,.173),(.12,.192),(.098,.196),(.092,.193),(.055,.105),(.045,.055)],'shirt',torso_rig,sides=28)
    cylinder('Neck',(0,-.085,.485),.047,.115,'skin_light',torso_rig,24)
    box('Belt',(0,-.003,.025),(.325,.224,.035),'black',.023,torso_rig)
    box('BeltBuckle',(0,-.121,.026),(.043,.012,.031),'silver',.004,torso_rig)
    for s in (-1,1):
        box('TorsoCollar',(s*.040,-.10,.441),(.062,.053,.012),'shirt',.005,torso_rig,rot=(.24,s*.25,s*.37))
    for z in (.414,.388,.363):sphere('PoloButton',(0,-.188,z),(.003,)*3,'cream',torso_rig,segments=8,rings=6)
    beam('Placket',(0,-.191,.34),(0,-.174,.44),.0025,'stitch',torso_rig,8)
    head_rig=empty('HeadRig',parent=ROOT)
    pieces=[sphere('Head',(0,0,0),(.086,.081,.117),'skin_light',head_rig,segments=32,rings=24),
            sphere('Jaw',(0,-.012,-.071),(.069,.064,.044),'skin_light',head_rig,segments=24,rings=16)]
    organic_merge(pieces,'FaceAnatomy',.010)
    sphere('NoseBridge',(0,-.079,-.001),(.013,.024,.027),'skin_light',head_rig,segments=20,rings=12)
    sphere('NoseTip',(0,-.098,-.013),(.016,.014,.012),'skin_light',head_rig,segments=16,rings=10)
    for s in (-1,1):
        sphere('Ear',(s*.085,.004,-.006),(.012,.021,.029),'skin_light',head_rig,segments=20,rings=12)
        sphere('EyeWhite',(s*.033,-.074,.025),(.012,.006,.006),'white',head_rig,segments=16,rings=10)
        sphere('HumanEye',(s*.033,-.080,.025),(.005,.002,.005),'eye',head_rig,segments=12,rings=8)
        beam('Eyebrow',(s*.022,-.077,.043),(s*.045,-.072,.042),.0023,'feather_dark',head_rig,8)
        sphere('HairAtTemple',(s*.074,.007,.038),(.012,.045,.025),'feather_dark',head_rig,segments=16,rings=10)
    beam('Mouth',(-.020,-.079,-.045),(.020,-.079,-.045),.0018,'skin',head_rig,8)
    sphere('CapCrown',(0,.002,.092),(.092,.09,.044),'cream',head_rig,segments=28,rings=16)
    sphere('CapBrim',(0,-.098,.073),(.095,.10,.007),'cream',head_rig,segments=24,rings=10)
    for s in (-1,1):beam('CapStitch',(s*.055,-.055,.119),(s*.058,.041,.116),.0015,'stitch',head_rig,6)
    text('CapBadge','G',(0,-.086,.105),.026,'navy',head_rig)
    hips=[]
    for s,label in [(1,'Left'),(-1,'Right')]:
        hip=empty(label+'Hip',(s*.146,.066,.90),ROOT);hip.rotation_euler.x=-.14
        sphere('TrouserSeat',(0,0,-.025),(.088,.083,.087),'navy',hip,segments=20,rings=14)
        sweep(label+'Thigh',[(0,0,0),(0,0,-.13),(0,0,-.31),(0,0,-.43)],[.085,.079,.067,.060],'navy',hip,sides=20)
        beam('TrouserCrease',(0,-.084,-.04),(0,-.061,-.40),.0015,'black',hip,8)
        knee=empty(label+'Knee',(0,0,-.43),hip);knee.rotation_euler.x=.25
        sphere('TrouserKnee',(0,0,-.010),(.063,.062,.070),'navy',knee,segments=20,rings=14)
        sweep(label+'Shin',[(0,0,0),(0,0,-.12),(0,0,-.29),(0,0,-.41)],[.062,.061,.052,.045],'navy',knee,sides=20)
        ankle=empty(label+'Ankle',(0,0,-.41),knee);ankle.rotation_euler.x=-.11
        sphere(label+'Shoe',(0,-.055,-.007),(.067,.128,.048),'cream',ankle,segments=24,rings=16)
        box('ShoeSole',(0,-.055,-.045),(.135,.247,.029),'rubber',.012,ankle)
        sphere('ShoeHeel',(0,.032,-.004),(.060,.037,.036),'navy',ankle,segments=16,rings=10)
        for k in range(4):beam('ShoeLace',(-.031,-.038-k*.016,.033),(.031,-.038-k*.016,.033),.0018,'white',ankle,6)
        hips.append((hip,knee,ankle,s))
    arms=[]
    for s,label in [(1,'Left'),(-1,'Right')]:
        upper=empty(label+'Shoulder',parent=ROOT);upper.rotation_mode='QUATERNION'
        sweep(label+'UpperArm',[(0,0,0),(0,0,.09),(0,0,.19),(0,0,.215)],[.061,.053,.044,.043],'shirt',upper,sides=20)
        sphere(label+'UpperArmShoulder',(0,0,.012),(.055,.055,.050),'shirt',upper,segments=20,rings=12)
        sweep('UpperArmSkin',[(0,0,.19),(0,0,.27),(0,0,.31)],[.043,.036,.035],'skin_light',upper,sides=16)
        fore=empty(label+'Elbow',parent=ROOT);fore.rotation_mode='QUATERNION'
        sphere('Elbow',(0,0,0),(.035,.035,.035),'skin_light',fore,segments=20,rings=12)
        sweep(label+'Forearm',[(0,0,0),(0,0,.085),(0,0,.20),(0,0,.28)],[.035,.036,.029,.024],'skin_light',fore,sides=20)
        hand=empty(label+'Wrist',parent=ROOT);hand.rotation_mode='QUATERNION'
        sphere('LeftGlove' if s>0 else 'RightHand',(0,0,0),(.027,.032,.047),'white' if s>0 else 'skin_light',hand,segments=20,rings=14)
        for j in range(3):beam('FingerSeam',(-.012+j*.009,-.029,-.023),(-.012+j*.009,-.030,.009),.0012,'stitch' if s>0 else 'skin',hand,6)
        arms.append((s,upper,fore,hand))
    club=empty('ClubRig',parent=ROOT);club.rotation_mode='QUATERNION'
    club_drop=.97-.1391304347826087
    club_length=math.sqrt(.33**2+club_drop**2)
    beam('ClubGrip',(0,0,-.063),(0,0,.167),.011,'black',club,16)
    for j in range(12):torus('GripRing',(0,0,-.051+j*.018),.0115,.0008,'rubber',club,segments=12,minor_segments=4)
    beam('ClubShaft',(0,0,.167),(0,0,club_length-.015),.005,'chrome',club,16,r2=.0036)
    box('ClubHead',(0,0,club_length),(.132,.048,.04),'silver',.008,club,rot=(0,.1,0))
    for z in (club_length-.010,club_length,club_length+.010):beam('IronGroove',(-.05,-.025,z),(.05,-.025,z),.0009,'metal',club,6)
    # Keys define a genuine large pendulum arc, with independent wrist release.
    # Shoulder and hip turn are baked with a two-bone IK solution for each arm.
    poses=[(1,0,0,0,0),(9,-25,-31,-.28,-.08),(17,-63,-74,-.72,-.20),
           (24,-140,-255,-1.10,-.32),(28,-139,-245,-1.13,-.24),
           (31,-78,-137,-.60,.08),(34,-14,-29,.02,.30),(35,0,0,.13,.37),
           (38,43,88,.61,.60),(43,96,178,1.04,.80),(49,139,244,1.35,.94),
           (54,145,265,1.46,1.02),(60,145,265,1.46,1.02),
           (65,95,185,.95,.61),(69,30,40,.36,.22),(73,0,0,0,0)]
    def parameters(frame):
        for index in range(len(poses)-1):
            a,b=poses[index],poses[index+1]
            if a[0]<=frame<=b[0]:
                t=(frame-a[0])/(b[0]-a[0]);out=[]
                prev=poses[max(0,index-1)];nxt=poses[min(len(poses)-1,index+2)]
                for k in range(1,5):
                    m0=(b[k]-prev[k])/(b[0]-prev[0])*(b[0]-a[0])
                    m1=(nxt[k]-a[k])/(nxt[0]-a[0])*(b[0]-a[0])
                    out.append((2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*m1)
                return out
        return list(poses[-1][1:])
    def key(o,frame,scale=False):
        o.keyframe_insert(data_path='location',frame=frame)
        o.keyframe_insert(data_path='rotation_quaternion' if o.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame)
        if scale:o.keyframe_insert(data_path='scale',frame=frame)
    def limb(rig,a,b,length,frame):
        rig.location=a;d=Vector(b)-Vector(a);rig.rotation_quaternion=d.to_track_quat('Z','Y')
        rig.scale=(1,1,d.length/length);key(rig,frame,True)
    shoulder_local=Vector((0,-.085,.445));u=Vector((1,0,0))
    hand_down=Vector((0,-.23,-.4));hand_radius=hand_down.length;hand_down.normalize()
    club_down=Vector((0,-.33,-club_drop)).normalized()
    for frame in range(1,74):
        h_angle,c_angle,turn,hip_turn=parameters(frame)
        follow=max(0,min(1,h_angle/145));shift=.065*follow-.020*max(0,-h_angle/140)
        tilt=.30-.22*follow
        torso_rig.location=(shift,.08,.970);torso_rig.rotation_euler=(tilt,-.04*math.sin(math.radians(h_angle)),turn)
        pelvis.location=(shift,.076,.930);pelvis.rotation_euler.z=hip_turn;key(torso_rig,frame);key(pelvis,frame)
        rot=torso_rig.rotation_euler.to_matrix();center=torso_rig.location+rot@shoulder_local
        # Address and impact are identical in club position, even as the pelvis
        # and chest open toward the target at impact.
        arc_center=Vector((shift,-.15,1.37+.030*follow))
        hands=arc_center+hand_radius*(u*math.sin(math.radians(h_angle))+hand_down*math.cos(math.radians(h_angle)))
        wrap=max(0,min(1,(abs(h_angle)-95)/50));hands.y+=.21*wrap*wrap*(3-2*wrap)
        if frame in (1,35,73):hands=Vector((0,-.38,.97))
        direction=u*math.sin(math.radians(c_angle))+club_down*math.cos(math.radians(c_angle));direction.normalize()
        club.location=hands;club.rotation_quaternion=direction.to_track_quat('Z','Y');key(club,frame)
        for side,upper,fore,hand in arms:
            shoulder=torso_rig.location+rot@Vector((side*.185,-.085,.425))
            wrist=hands+direction*(.023 if side>0 else -.022)
            delta=wrist-shoulder;distance=min(delta.length,.586);axis=delta.normalized()
            pole=Vector((side*.12,-.85 if side>0 else .60,-.10))
            bend=(pole-axis*pole.dot(axis)).normalized()
            along=(.31**2-.28**2+distance**2)/(2*distance)
            elbow=shoulder+axis*along+bend*math.sqrt(max(0,.31**2-along**2))
            limb(upper,shoulder,elbow,.31,frame);limb(fore,elbow,wrist,.28,frame)
            hand.location=wrist;hand.rotation_quaternion=club.rotation_quaternion;key(hand,frame)
        head_rig.location=torso_rig.location+rot@Vector((0,-.075,.657))
        head_rig.rotation_euler=(.19-.12*follow,0,.08*turn+.65*follow);key(head_rig,frame)
        for hip,knee,ankle,side in hips:
            hip.location=(side*.146+shift*.32,.066,.90)
            hip.rotation_euler=(-.14-.08*follow if side>0 else -.14+.10*follow,0,hip_turn*.15)
            knee.rotation_euler.x=.25+.08*follow if side<0 else .25-.05*follow
            ankle.rotation_euler.x=-(hip.rotation_euler.x+knee.rotation_euler.x)+(.27*follow if side<0 else 0)
            key(hip,frame);key(knee,frame);key(ankle,frame)
    CURRENT.frame_set(1)
    for name in ('Torso','LeftUpperArm','RightUpperArm'):
        active=CURRENT.objects.get(name);mat=active.data.materials[0]
        parts=[o for o in CURRENT.objects if o.type=='MESH' and o.parent==active.parent and len(o.data.materials)==1 and o.data.materials[0]==mat]
        if len(parts)>1:
            bpy.ops.object.select_all(action='DESELECT')
            for o in parts:o.select_set(True)
            bpy.context.view_layer.objects.active=active;bpy.ops.object.join();active.name=name
    # Rig transforms are animated; meshes within each rigid part can still merge
    # by material while named shirt meshes remain available to the application.
    join_material_groups()


def export_assets(preserve_manifest=False):
    manifest={'title':'Golf Range Simulator','style':'Naturalistic PBR — timber, steel, organic foliage and realistic proportions',
      'coordinates':{'blender':'Z up, -Y forward','glb':'Y up, +Z forward','units':'metres'},
      'source':'blender/build_realistic_assets.py','textures':'Original procedural textures, embedded PNG', 'assets':[]}
    if preserve_manifest and (BASE/'manifest.json').exists():
        manifest=json.loads((BASE/'manifest.json').read_text(encoding='utf8'))
    for a in ASSETS:
        scene=a['scene'];bpy.context.window.scene=scene;scene.frame_set(1)
        # Tangent frames require actual triangles and nondegenerate UVs. Blender
        # primitive bevels and merged cylindrical endcaps otherwise contain UV
        # wedges of zero area. Preserve purpose-authored leaf and ball UVs.
        for o in list(scene.objects):
            if o.type!='MESH':continue
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            textured=any(mat.use_nodes and any(node.bl_idname=='ShaderNodeBump' for node in mat.node_tree.nodes) for mat in o.data.materials)
            if textured and a['name']!='golf-ball':
                bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.uv.smart_project(angle_limit=.8,island_margin=.008)
                bpy.ops.object.mode_set(mode='OBJECT')
            mod=o.modifiers.new('Export triangulation','TRIANGULATE')
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.select_all(action='DESELECT')
        for o in scene.objects:o.select_set(True)
        bpy.context.view_layer.objects.active=a['root'];original_name=scene.name
        if a['animated']:scene.name='PracticeSwing' if a['name']=='golfer' else 'Walk'
        bpy.ops.export_scene.gltf(filepath=str(OUT/(a['name']+'.glb')),export_format='GLB',
          use_selection=True,use_active_scene=True,export_extras=True,export_animations=a['animated'],
          export_animation_mode='SCENE',export_anim_scene_split_object=False,
          export_frame_range=True,export_force_sampling=True,export_cameras=False,export_lights=False,
          export_materials='EXPORT',export_image_format='AUTO',export_tangents=True,export_anim_slide_to_zero=True)
        remove_unused_tangents(OUT/(a['name']+'.glb'))
        scene.name=original_name;meshes=[o for o in scene.objects if o.type=='MESH']
        tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
        points=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
        bounds=[min(p[i] for p in points) for i in range(3)]+[max(p[i] for p in points) for i in range(3)]
        entry={'id':a['name'],'file':'models/'+a['name']+'.glb','description':a['description'],
          'triangles_source':tris,'mesh_count':len(meshes),'material_count':len(set(mat.name for o in meshes for mat in o.data.materials)),
          'bounds_blender':bounds,'animated':a['animated'],'animation':'PracticeSwing' if a['name']=='golfer' else ('Walk' if a['animated'] else None)}
        if 'animation_contract' in a:entry['animation_contract']=a['animation_contract']
        index=next((i for i,item in enumerate(manifest['assets']) if item['id']==a['name']),None)
        if index is None:manifest['assets'].append(entry)
        else:manifest['assets'][index]=entry
    (BASE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')


def copy_asset(name,loc,scale=1,rotz=0):
    asset=next(a for a in ASSETS if a['name']==name);copies={}
    for src in asset['scene'].objects:
        cp=src.copy();cp.animation_data_clear();CURRENT.collection.objects.link(cp);copies[src]=cp
    for src,cp in copies.items():
        cp.parent=copies.get(src.parent)
        if not src.parent:cp.location=loc;cp.scale=(scale,)*3;cp.rotation_euler.z=rotz


def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()


def showroom():
    global CURRENT,ROOT
    CURRENT=bpy.data.scenes.new('SHOWROOM | Naturalistic asset kit');bpy.context.window.scene=CURRENT
    ROOT=empty('Showroom');CURRENT.render.engine='CYCLES';CURRENT.cycles.samples=24
    CURRENT.render.resolution_x=1440;CURRENT.render.resolution_y=960;CURRENT.render.resolution_percentage=100
    CURRENT.world=bpy.data.worlds.new('Studio sky');CURRENT.world.use_nodes=True
    bg=CURRENT.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.42,.51,.60,1);bg.inputs[1].default_value=.5
    CURRENT.view_settings.view_transform='AgX';CURRENT.render.image_settings.file_format='PNG'
    box('StudioFloor',(0,0,-.15),(100,100,.25),'concrete',.02)
    copy_asset('tractor-picker',(-3.0,-2.25,0),rotz=-.30)
    copy_asset('ball-depot',(2.5,-1.4,0),.87)
    copy_asset('hitting-bay',(-3.1,3,0))
    copy_asset('golfer',(-3.5,2.4,.18))
    copy_asset('goose',(.4,2.1,0),1.3,rotz=-.4)
    copy_asset('fox',(1.8,2.5,0),1.3,rotz=-.4)
    copy_asset('deer',(3.4,3.0,0),1.15,rotz=-.4)
    copy_asset('tree-pine',(6.0,2.6,0),1.25)
    copy_asset('tree-broadleaf',(7.7,2.4,0),1.15)
    copy_asset('fence-section',(6.8,.4,0),1)
    copy_asset('target-flag',(6,-1.5,0))
    for i,n in enumerate((50,100,150)):copy_asset('distance-marker-'+str(n),(6.15+i*.75,-3+i*.24,0),.62)
    copy_asset('golf-ball',(7.3,-1.3,0),6)
    light=bpy.data.objects.new('Sun',bpy.data.lights.new('Sun','SUN'));CURRENT.collection.objects.link(light)
    light.rotation_euler=(.55,-.48,-.6);light.data.energy=2.3;light.data.angle=.09
    light=bpy.data.objects.new('Softbox',bpy.data.lights.new('Softbox','AREA'));CURRENT.collection.objects.link(light)
    light.location=(-5,-5,10);light.data.energy=1500;light.data.shape='DISK';light.data.size=8;aim(light,(0,0,1))
    camera=bpy.data.objects.new('AssetCamera',bpy.data.cameras.new('AssetCamera'));CURRENT.collection.objects.link(camera)
    CURRENT.camera=camera;camera.location=(14,-20,16);aim(camera,(1,.5,1));camera.data.type='ORTHO';camera.data.ortho_scale=18.3
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    return camera


def wildlife_showroom():
    global CURRENT,ROOT
    CURRENT=bpy.data.scenes.new('PREVIEW | Wildlife');bpy.context.window.scene=CURRENT
    ROOT=empty('WildlifePreview');CURRENT.render.engine='CYCLES';CURRENT.cycles.samples=32
    CURRENT.render.resolution_x=1440;CURRENT.render.resolution_y=900;CURRENT.render.resolution_percentage=100
    CURRENT.world=bpy.data.worlds.new('Wildlife studio sky');CURRENT.world.use_nodes=True
    bg=CURRENT.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.52,.60,.65,1);bg.inputs[1].default_value=.65
    CURRENT.view_settings.view_transform='AgX';CURRENT.render.image_settings.file_format='PNG'
    box('WildlifeFloor',(0,0,-.11),(100,100,.20),'concrete')
    copy_asset('goose',(-1.85,-.22,0),1.15,rotz=-.20)
    copy_asset('fox',(-.40,.10,0),1.10,rotz=-.35)
    copy_asset('deer',(1.34,.38,0),1,rotz=-.35)
    light=bpy.data.objects.new('WildlifeSun',bpy.data.lights.new('WildlifeSun','SUN'));CURRENT.collection.objects.link(light)
    light.rotation_euler=(.48,-.43,-.62);light.data.energy=2.2;light.data.angle=.13
    light=bpy.data.objects.new('WildlifeSoftbox',bpy.data.lights.new('WildlifeSoftbox','AREA'));CURRENT.collection.objects.link(light)
    light.location=(-3,-4,7);light.data.energy=900;light.data.shape='DISK';light.data.size=5;aim(light,(0,0,.7))
    camera=bpy.data.objects.new('WildlifeCamera',bpy.data.cameras.new('WildlifeCamera'));CURRENT.collection.objects.link(camera)
    CURRENT.camera=camera;camera.location=(4.0,-7,3.8);aim(camera,(-.2,.1,.85));camera.data.type='ORTHO';camera.data.ortho_scale=5.25
    CURRENT.render.filepath=str(PREVIEW/'wildlife.png');bpy.ops.render.render(write_still=True)


def golfer_swing_preview():
    """Six original rendered frames, combined without external image tooling."""
    global CURRENT,ROOT
    asset=next(a for a in ASSETS if a['name']=='golfer')
    CURRENT=bpy.data.scenes.new('PREVIEW | Right handed swing');bpy.context.window.scene=CURRENT
    ROOT=empty('SwingPreview');CURRENT.render.engine='CYCLES';CURRENT.cycles.samples=24
    width,height=560,640
    CURRENT.render.resolution_x=width;CURRENT.render.resolution_y=height;CURRENT.render.resolution_percentage=100
    CURRENT.world=bpy.data.worlds.new('Swing studio sky');CURRENT.world.use_nodes=True
    bg=CURRENT.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.53,.61,.66,1);bg.inputs[1].default_value=.75
    CURRENT.view_settings.view_transform='AgX';CURRENT.render.image_settings.file_format='PNG'
    box('SwingStudioFloor',(0,0,-.025),(100,100,.03),'concrete')
    cylinder('PracticeTee',(0,-.71,.057),.009,.114,'cream',vertices=12)
    sphere('PracticeBall',(0,-.71,.1391304347826087),(.021335,)*3,'white',segments=16,rings=12)
    copies={}
    for src in asset['scene'].objects:
        cp=src.copy();CURRENT.collection.objects.link(cp);copies[src]=cp
    for src,cp in copies.items():cp.parent=copies.get(src.parent)
    light=bpy.data.objects.new('SwingSun',bpy.data.lights.new('SwingSun','SUN'));CURRENT.collection.objects.link(light)
    light.rotation_euler=(.53,-.49,-.6);light.data.energy=2.0;light.data.angle=.12
    light=bpy.data.objects.new('SwingSoftbox',bpy.data.lights.new('SwingSoftbox','AREA'));CURRENT.collection.objects.link(light)
    light.location=(-3,-5,6);light.data.energy=700;light.data.size=5;aim(light,(0,-.1,1))
    camera=bpy.data.objects.new('SwingCamera',bpy.data.cameras.new('SwingCamera'));CURRENT.collection.objects.link(camera)
    CURRENT.camera=camera;camera.location=(3,-6,2.3);aim(camera,(0,-.05,1.0));camera.data.type='ORTHO';camera.data.ortho_scale=3.45
    label=text('SwingFrameLabel','ADDRESS',(0,-1.29,-4),.115,'navy',camera,rot=(0,0,0))
    label.location=(0,-1.29,-4)
    output=np.ones((height*2,width*3,4),dtype=np.float32)
    for index,(frame,title) in enumerate([(1,'ADDRESS'),(17,'TAKEAWAY'),(24,'BACKSWING'),(35,'IMPACT'),(43,'RELEASE'),(54,'FINISH')]):
        # Text was converted to a mesh by the standard helper; rebuild the
        # caption so each render carries a readable camera-aligned label.
        bpy.data.objects.remove(label,do_unlink=True)
        label=text('SwingFrameLabel',title,(0,-1.29,-4),.115,'navy',camera,rot=(0,0,0))
        CURRENT.frame_set(frame);CURRENT.render.filepath=str(PREVIEW/('swing-frame-'+str(frame)+'.png'))
        bpy.ops.render.render(write_still=True)
        src=bpy.data.images.load(CURRENT.render.filepath,check_existing=False)
        pixels=np.array(src.pixels[:],dtype=np.float32).reshape(height,width,4)
        row=1-index//3;col=index%3
        output[row*height:(row+1)*height,col*width:(col+1)*width,:]=pixels
        bpy.data.images.remove(src)
    sheet=bpy.data.images.new('Right-handed swing contact sheet',width*3,height*2,alpha=True)
    sheet.pixels.foreach_set(output.flatten());sheet.filepath_raw=str(PREVIEW/'golfer-swing.png');sheet.file_format='PNG';sheet.save();sheet.pack()
    CURRENT.frame_set(1)


def update_golfer_assets():
    """Keep the existing kit and re-export only golfer and mirrored tee bay."""
    global CURRENT,ROOT
    M.update({name[5:]:mat for name,mat in bpy.data.materials.items() if name.startswith('REAL_') and '.' not in name[5:]})
    replacements=[]
    for asset_id in ('golfer','hitting-bay'):
        roots=[o for o in list(bpy.data.objects) if o.get('asset')==asset_id]
        for root in roots:
            for scene in root.users_scene:
                if not scene.name.startswith('ASSET |') and not scene.name.startswith('PREVIEW |'):
                    replacements.append((asset_id,scene,root.location.copy(),root.scale.copy(),root.rotation_euler.copy()))
            for obj in list(root.children_recursive)+[root]:
                if obj.name in bpy.data.objects:bpy.data.objects.remove(obj,do_unlink=True)
        old=bpy.data.scenes.get('ASSET | '+asset_id)
        if old:bpy.data.scenes.remove(old)
    for scene in list(bpy.data.scenes):
        if scene.name.startswith('PREVIEW | Right handed swing'):
            for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
            bpy.data.scenes.remove(scene)
    golfer();bay();export_assets(preserve_manifest=True)
    for asset_id,scene,loc,scale,rotation in replacements:
        CURRENT=scene;bpy.context.window.scene=scene
        asset=next(a for a in ASSETS if a['name']==asset_id);copies={}
        for src in asset['scene'].objects:
            cp=src.copy();cp.animation_data_clear();CURRENT.collection.objects.link(cp);copies[src]=cp
        for src,cp in copies.items():
            cp.parent=copies.get(src.parent)
            if not src.parent:cp.location=loc;cp.scale=scale;cp.rotation_euler=rotation
    golfer_swing_preview()
    CURRENT=next(s for s in bpy.data.scenes if s.name.startswith('SHOWROOM |'));bpy.context.window.scene=CURRENT
    CURRENT.frame_set(1);CURRENT.render.filepath=str(PREVIEW/'asset-kit.png');bpy.ops.render.render(write_still=True)
    for filename in ('build_realistic_assets.py','gltf_cleanup.py','finalize_exports.py'):
        source=bpy.data.texts.get(filename) or bpy.data.texts.new(filename)
        source.from_string((BASE/'blender'/filename).read_text(encoding='utf8'));source.filepath='//'+filename
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
    print('GOLFER AND MIRRORED BAY UPDATE COMPLETE',flush=True)


def main():
    global CURRENT
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials();tractor();props();depot();bay();goose();quadruped('fox');quadruped('deer');golfer();export_assets()
    cam=showroom()
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
    CURRENT.render.filepath=str(PREVIEW/'asset-kit.png');bpy.ops.render.render(write_still=True)
    CURRENT.render.resolution_x=1200;CURRENT.render.resolution_y=800
    cam.location=(.5,-8,4);aim(cam,(-3,-2.25,1));cam.data.ortho_scale=5.5
    CURRENT.render.filepath=str(PREVIEW/'tractor-picker.png');bpy.ops.render.render(write_still=True)
    showroom_scene=CURRENT
    wildlife_showroom();golfer_swing_preview();CURRENT=showroom_scene;bpy.context.window.scene=CURRENT
    cam.location=(14,-20,16);aim(cam,(1,.5,1));cam.data.ortho_scale=18.3
    CURRENT.render.resolution_x=1440;CURRENT.render.resolution_y=960
    for filename in ('build_realistic_assets.py','gltf_cleanup.py','finalize_exports.py'):
        source=bpy.data.texts.get(filename) or bpy.data.texts.new(filename)
        source.from_string((BASE/'blender'/filename).read_text(encoding='utf8'));source.filepath='//'+filename
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
    (BASE/'BUILD_COMPLETE.json').write_text(json.dumps({'status':'complete','assets':len(ASSETS),'blender':bpy.app.version_string,'style':'naturalistic PBR'}))
    print('REALISTIC ASSETS COMPLETE:',len(ASSETS),flush=True)


if __name__=='__main__':
    if '--update-golfer' in sys.argv:update_golfer_assets()
    else:main()

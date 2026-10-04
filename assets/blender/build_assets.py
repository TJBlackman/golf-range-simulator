"""Run inside Blender's Text Editor (Alt-P). Generates original game assets.

Preserves existing scenes. All dimensions are metres; Blender +Z up, -Y forward.
GLB export converts to +Y up, +Z forward. No external assets or dependencies.
"""
import bpy
import math
import json
import traceback
from pathlib import Path
from mathutils import Vector

SOURCE = Path(__file__)
if not SOURCE.is_absolute():
    SOURCE = Path(bpy.path.abspath(bpy.data.texts.get(SOURCE.name).filepath))
BASE = SOURCE.resolve().parents[1]
OUT = BASE / 'models'
PREVIEW = BASE / 'previews'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
ASSETS = []
CURRENT = None
ROOT = None

def material(name, color, roughness=.75, metallic=0):
    m = bpy.data.materials.new('GRS_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return m

M = {}
for n, c in {
    'orange':(.95,.24,.045), 'orange_dark':(.52,.075,.015),
    'cream':(.91,.84,.64), 'white':(.96,.97,.90), 'black':(.018,.025,.025),
    'rubber':(.035,.045,.044), 'metal':(.20,.27,.29), 'silver':(.54,.63,.63),
    'glass':(.20,.54,.58), 'grass':(.16,.38,.14), 'grass_light':(.26,.49,.18),
    'grass_dark':(.10,.25,.09), 'sand':(.72,.57,.32), 'wood':(.28,.15,.07),
    'wood_light':(.53,.30,.12), 'red':(.85,.08,.06), 'yellow':(1,.64,.045),
    'blue':(.035,.27,.42), 'fox':(.74,.22,.045), 'fox_light':(.97,.74,.44),
    'deer':(.43,.23,.105), 'deer_light':(.72,.49,.28),
    'skin':(.66,.38,.22), 'navy':(.045,.09,.15), 'concrete':(.41,.48,.43),
}.items():
    M[n] = material(n,c,.45 if n in ('orange','glass') else .8,
                    .5 if n in ('metal','silver') else 0)

def start(name, description, animated=False):
    global CURRENT, ROOT
    CURRENT = bpy.data.scenes.new('ASSET | ' + name)
    bpy.context.window.scene = CURRENT
    CURRENT.unit_settings.system = 'METRIC'
    CURRENT.render.fps = 24
    CURRENT.frame_start = 1
    CURRENT.frame_end = 49
    ROOT = empty(name)
    ROOT['asset'] = name
    ROOT['units'] = 'metres'
    ROOT['forward'] = '-Y in Blender; +Z in glTF'
    ROOT['description'] = description
    ASSETS.append({'name':name,'description':description,'scene':CURRENT,
                   'root':ROOT,'animated':animated})
    return ROOT

def empty(name, loc=(0,0,0), parent=None):
    o = bpy.data.objects.new(name,None)
    CURRENT.collection.objects.link(o)
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = .15
    o.parent = parent
    o.location = loc
    return o

def finish(o,name,mat,parent=None):
    o.name = name
    o.parent = parent or ROOT
    if mat:
        o.data.materials.append(M[mat])
    return o

def box(name, loc, size, mat, bevel=0, parent=None, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = finish(bpy.context.object,name,mat,parent)
    o.scale = size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod = o.modifiers.new('Soft manufactured edges','BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.rotation_euler = rot
    return o

def sphere(name,loc,size,mat,parent=None,segments=12,rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
    o=finish(bpy.context.object,name,mat,parent)
    o.scale=size
    return o

def ico(name,loc,size,mat,parent=None,sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc)
    o=finish(bpy.context.object,name,mat,parent)
    o.scale=size
    return o

def cylinder(name,loc,radius,depth,mat,parent=None,vertices=12,rot=(0,0,0),r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,
        radius2=radius if r2 is None else r2,depth=depth,location=loc)
    o=finish(bpy.context.object,name,mat,parent)
    o.rotation_euler=rot
    return o

def beam(name,a,b,r,mat,parent=None,vertices=8):
    d=Vector(b)-Vector(a)
    o=cylinder(name,(Vector(a)+Vector(b))/2,r,d.length,mat,parent,vertices)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return o

def mesh(name,verts,faces,mat,parent=None):
    data=bpy.data.meshes.new(name)
    data.from_pydata(verts,[],faces)
    data.update()
    o=bpy.data.objects.new(name,data)
    CURRENT.collection.objects.link(o)
    return finish(o,name,mat,parent)

def text(name,body,loc,size,mat,parent=None,rot=(math.pi/2,0,0)):
    data=bpy.data.curves.new(name,'FONT')
    data.body=body
    data.align_x='CENTER'
    data.align_y='CENTER'
    data.size=size
    data.extrude=.001
    o=bpy.data.objects.new(name,data)
    CURRENT.collection.objects.link(o)
    o.location=loc
    o.rotation_euler=rot
    o.parent=parent or ROOT
    data.materials.append(M[mat])
    bpy.context.view_layer.objects.active=o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    return o

def walk(pivots, amplitude=.45):
    for p,phase in pivots:
        for f in range(1,50,4):
            p.rotation_euler.x=math.sin((f-1)/48*math.tau+phase)*amplitude
            p.keyframe_insert(data_path='rotation_euler',frame=f)
        p.rotation_euler.x=math.sin(phase)*amplitude
        p.keyframe_insert(data_path='rotation_euler',frame=49)
        p.animation_data.action.name='Walk__'+p.name

def eye_pair(prefix,y,z,x,mat='black',parent=None,r=.028):
    for side in (-1,1):
        sphere(prefix+('_L' if side<0 else '_R'),(side*x,y,z),(r,r*.65,r),mat,parent,8,6)

def tractor():
    start('tractor-picker','Orange range tractor with wide disk picker, open rear hopper and independent wheel pivots.')
    box('Chassis',(0,0,.54),(1.32,2.62,.25),'metal',.06)
    box('EngineHood',(0,-.76,1.03),(1.08,1.30,.69),'orange',.12)
    box('Grille',(0,-1.425,1.02),(.84,.03,.39),'black',.02)
    for x in [-.32,-.21,-.10,.01,.12,.23,.34]:
        box('GrilleSlat',(x,-1.445,1.02),(.025,.024,.32),'silver',.006)
    for x in (-.42,.42):
        box('Headlight',(x,-1.425,1.27),(.18,.045,.10),'cream',.025)
    box('FrontBumper',(0,-1.48,.65),(1.28,.17,.16),'silver',.03)
    cylinder('Exhaust',( .40,-.37,1.50),.05,.85,'metal',vertices=10)
    cylinder('ExhaustCap',(.40,-.37,1.94),.07,.05,'black',vertices=10)
    for side in (-1,1):
        for y,r,z in [(-.84,.36,.39),(.74,.48,.50)]:
            steering=empty(('Front' if y<0 else 'Rear')+('_L' if side<0 else '_R')+'_Steer',
                (side*.78,y,z),ROOT)
            wheel=empty(('Front' if y<0 else 'Rear')+('_L' if side<0 else '_R')+'_Wheel',(0,0,0),steering)
            cylinder('Tire',(0,0,0),r,.26,'rubber',wheel,16,rot=(0,math.pi/2,0))
            cylinder('WheelRim',(side*.145,0,0),r*.54,.045,'cream',wheel,12,rot=(0,math.pi/2,0))
            cylinder('Hub',(side*.177,0,0),r*.20,.055,'orange',wheel,10,rot=(0,math.pi/2,0))
            for k in range(12):
                a=k*math.tau/12
                box('Tread',(0,math.sin(a)*r,math.cos(a)*r),(.285,.095,.065),
                    'black',.01,wheel,rot=(-a,0,0))
        box('RearFender',(side*.74,.74,1.06),(.42,1.02,.08),'orange',.04)
        box('Step',(side*.76,.02,.45),(.35,.36,.07),'silver',.02)
    box('SeatBase',(0,.39,.93),(.50,.52,.16),'black',.05)
    box('SeatBack',(0,.65,1.19),(.50,.14,.52),'black',.05,rot=(.12,0,0))
    beam('SteeringColumn',(0,.01,.78),(0,-.14,1.30),.035,'metal')
    bpy.ops.mesh.primitive_torus_add(major_segments=16,minor_segments=6,major_radius=.19,minor_radius=.022,
                                    location=(0,-.14,1.30),rotation=(.35,0,0))
    finish(bpy.context.object,'SteeringWheel','black')
    for side in (-1,1):
        beam('CanopyPost',(side*.54,.87,.88),(side*.54,.87,2.03),.035,'metal')
    box('Canopy',(0,.35,2.08),(1.47,1.66,.12),'cream',.07)
    cylinder('Beacon',(0,.77,2.21),.075,.15,'yellow',vertices=10)
    box('HopperFloor',(0,1.28,.70),(1.42,.78,.10),'orange_dark',.035)
    for x in (-.73,.73):
        box('HopperSide',(x,1.28,.97),(.065,.83,.48),'orange',.03)
    for y in (.86,1.70):
        box('HopperEnd',(0,y,.97),(1.46,.065,.48),'orange',.03)
    empty('HopperFillAnchor',(0,1.27,.77),ROOT)['capacity_hint']=100
    beam('PickerTowLeft',(-.46,-1.25,.44),(-1,-1.95,.22),.045,'metal')
    beam('PickerTowRight',(.46,-1.25,.44),(1,-1.95,.22),.045,'metal')
    box('PickerCrossbar',(0,-1.93,.36),(2.92,.13,.10),'orange',.035)
    picker=empty('CollectorRoller',(0,-2.04,.22),ROOT)
    cylinder('CollectorAxle',(0,0,0),.045,2.85,'silver',picker,12,(0,math.pi/2,0))
    for k in range(32):
        cylinder('PickupDisk',(-1.36+k*.088,0,0),.20,.022,'rubber',picker,12,(0,math.pi/2,0))
    for x in (-1.50,1.50):
        cylinder('CollectorGuideWheel',(x,-2.04,.20),.20,.09,'orange',vertices=12,rot=(0,math.pi/2,0))
    empty('CollectionZone',(0,-2.04,.1),ROOT)['width_metres']=2.85

def props():
    start('golf-ball','Lightweight smooth white golf ball, regulation 42.67 mm diameter; instance this mesh.')
    o=sphere('Ball',(0,0,.021335),(.021335,)*3,'white',segments=12,rings=8)
    for p in o.data.polygons:p.use_smooth=True
    start('target-flag','Flexible-looking red flag, pole and target cup.')
    cylinder('Cup',(0,0,.008),.06,.016,'black',vertices=16)
    cylinder('Pole',(0,0,1.05),.014,2.10,'cream',vertices=10)
    mesh('Flag',[(0,0,2.05),(.28,.025,2.01),(.55,-.03,1.96),(.55,-.03,1.64),(.28,.025,1.68),(0,0,1.71)],
         [(0,1,4,5),(1,2,3,4)],'red')
    for distance,col in [(50,'red'),(100,'blue'),(150,'yellow')]:
        start('distance-marker-'+str(distance),'Freestanding '+str(distance)+' yard distance target.')
        for x in (-.38,.38):
            cylinder('Post',(x,0,.47),.045,.94,'wood',vertices=8)
        box('Board',(0,0,1.02),(1.28,.12,.66),col,.035)
        text('Yardage',str(distance),(0,-.068,1.075),.34,'white')
        text('Unit','YARDS',(0,-.068,.845),.105,'white')
    start('fence-section','Three metre modular timber boundary fence.')
    for x in (-1.45,1.45):
        box('Post',(x,0,.60),(.15,.15,1.20),'wood',.015)
        cylinder('PostCap',(x,0,1.25),.11,.12,'wood_light',vertices=4,r2=0)
    for z in (.40,.87):
        box('Rail',(0,0,z),(3.0,.095,.13),'wood_light',.015)
    start('tree-pine','Stylized evergreen with three layered foliage tiers.')
    cylinder('Trunk',(0,0,.65),.15,1.30,'wood',vertices=8)
    for z,r,h,col in [(1.3,.95,1.35,'grass_dark'),(1.95,.73,1.2,'grass'),(2.55,.50,1.0,'grass_light')]:
        cylinder('Foliage',(0,0,z),r,h,col,vertices=8,r2=0)
    start('tree-broadleaf','Chunky broadleaf tree with faceted crown.')
    cylinder('Trunk',(0,0,1),.16,2,'wood',vertices=7,r2=.10)
    for a,b in [((0,0,1.2),(-.55,0,2)),((0,0,1.3),(.60,.10,2.1))]:beam('Branch',a,b,.08,'wood')
    ico('Crown',(0,0,2.35),(1.04,.9,.9),'grass',sub=2)
    ico('CrownLight',(-.6,-.1,2.2),(.70,.67,.64),'grass_light',sub=1)
    ico('CrownDark',(.64,.16,2.23),(.64,.67,.73),'grass_dark',sub=1)
    start('range-ground','Reusable 60 x 90 metre driving range ground with alternating mowing strips and target greens.')
    box('Ground',(0,0,-.13),(60,90,.25),'grass')
    for i in range(12):
        box('MowingStrip',(-27.5+i*5,0,.002),(5,90,.008),'grass_light' if i%2 else 'grass')
    for x,y,r in [(-13,-9,4),(9,-22,4.7),(-7,-35,5.5)]:
        cylinder('TargetGreen',(x,y,.014),r,.025,'grass_dark',vertices=32)
        cylinder('TargetInner',(x,y,.03),r*.78,.008,'grass',vertices=32)

def depot():
    start('ball-depot','Return station with canopy, receiving chute, storage bin and marked unloading pad.')
    box('UnloadPad',(0,-1.1,.045),(4.4,3.9,.09),'concrete',.06)
    for x in (-1.93,1.93):box('PadStripe',(x,-1.55,.095),(.10,2.52,.012),'yellow')
    box('StopStripe',(0,-.30,.095),(3.86,.12,.012),'yellow')
    box('StorageBody',(0,1.05,.70),(2.95,1.40,1.35),'blue',.10)
    box('BinLip',(0,1.05,1.42),(3.10,1.52,.13),'cream',.045)
    box('BinTop',(0,1.05,1.49),(2.76,1.15,.04),'black',.01)
    for x in (-1.72,1.72):
        box('CanopyPost',(x,.45,1.27),(.13,.13,2.54),'wood',.025)
    mesh('Roof',[(-2,-.42,2.52),(2,-.42,2.52),(-2,1.95,2.52),(2,1.95,2.52),(-2,.75,2.97),(2,.75,2.97)],
         [(0,1,5,4),(4,5,3,2),(0,4,2),(1,3,5)],'orange')
    box('Sign',(0,-.38,2.33),(2.83,.09,.39),'cream',.035)
    text('SignText','BALL RETURN',(0,-.433,2.33),.235,'navy')
    box('ChuteFloor',(0,-.16,.91),(1.28,1.05,.065),'silver',.015,rot=(-.30,0,0))
    for x in (-.67,.67):box('ChuteWall',(x,-.16,1.04),(.065,1.05,.28),'silver',.015,rot=(-.30,0,0))
    text('PadText','UNLOAD',(0,-1.67,.101),.48,'cream',rot=(0,0,0))
    empty('UnloadZone',(0,-1.3,.12),ROOT)['size_metres']=[3.7,2.8]
    empty('BallReturnAnchor',(0,-.25,1.06),ROOT)

def bay():
    start('hitting-bay','Modular covered driving bay with mat, ball tray and dispenser.')
    box('Deck',(0,0,.08),(3,2.60,.16),'concrete',.035)
    box('TeeMat',(0,-.37,.18),(1.55,1.60,.05),'grass_dark',.025)
    box('MatEdge',(0,-.37,.153),(1.66,1.71,.045),'black',.015)
    cylinder('Tee',(.46,-.73,.25),.013,.12,'cream',vertices=8)
    for x in (-1.37,1.37):
        box('RoofPost',(x,.98,1.42),(.09,.09,2.65),'metal',.01)
        box('Divider',(x,-.1,.52),(.07,1.78,.80),'blue',.025)
    box('Roof',(0,.02,2.80),(3.2,2.95,.12),'cream',.045,rot=(-.05,0,0))
    box('Dispenser',(1,.82,.65),(.48,.44,1.12),'orange',.05)
    box('DispenseSlot',(1,.585,.47),(.31,.03,.14),'black',.01)
    box('BallTray',(.93,.15,.23),(.39,.73,.10),'metal',.025)
    for i in range(6):sphere('TrayBall',(.84+(i%2)*.12,-.04+(i//2)*.15,.30),(.045,)*3,'white',segments=8,rings=6)
    empty('BallLaunchAnchor',(.46,-.73,.31),ROOT)

def goose():
    start('goose','Canada goose with black neck, white cheek patches, layered wings and looping waddle.',True)
    body=empty('GooseBody',(0,0,0),ROOT)
    sphere('Body',(0,.06,.45),(.22,.37,.23),'cream',body)
    for x in (-.19,.19):sphere('Wing',(x,.08,.49),(.055,.29,.15),'deer',body)
    beam('Neck',(0,-.18,.53),(0,-.36,.90),.067,'black',body,10)
    sphere('Head',(0,-.37,.95),(.105,.14,.105),'black',body)
    for side in (-1,1):sphere('Cheek',(side*.088,-.40,.923),(.025,.066,.036),'white',body,8,6)
    beam('Beak',(0,-.47,.946),(0,-.60,.93),.042,'black',body,8)
    eye_pair('Eye',-.418,.978,.089,'white',body,r=.012)
    cylinder('Tail',(0,.39,.48),.13,.30,'black',body,6,(math.pi/2,0,0),0)
    legs=[]
    for side in (-1,1):
        p=empty('GooseLeg'+str(side),(side*.095,.06,.29),ROOT)
        beam('Leg',(0,0,0),(0,0,-.24),.02,'black',p)
        mesh('WebbedFoot',[(-.052,-.12,-.27),(.052,-.12,-.27),(.025,.045,-.27),(-.025,.045,-.27)],[(0,1,2,3)],'black',p)
        legs.append((p,0 if side<0 else math.pi))
    walk(legs,.30)
    for f,z in [(1,0),(13,.02),(25,0),(37,.02),(49,0)]:
        body.location.z=z;body.keyframe_insert(data_path='location',frame=f)

def quadruped(kind):
    isfox=kind=='fox'
    start(kind,('Alert red fox with white-tipped tail' if isfox else 'Antlered deer with cream chest and dark hooves')+' and looping walk.',True)
    col='fox' if isfox else 'deer'
    light='fox_light' if isfox else 'deer_light'
    z=.49 if isfox else .97
    sx=.15 if isfox else .23
    sy=.40 if isfox else .53
    body=empty(kind.title()+'Body',parent=ROOT)
    sphere('Torso',(0,.02,z),(sx,sy,.19 if isfox else .33),col,body)
    sphere('Chest',(0,-.22,z-.03),(sx*.92,.17,.20 if isfox else .31),light,body)
    if isfox:
        sphere('Head',(0,-.46,.68),(.155,.20,.15),col,body)
        cylinder('Muzzle',(0,-.65,.64),.087,.21,light,body,8,(math.pi/2,0,0),.025)
        sphere('Nose',(0,-.765,.64),(.035,.027,.025),'black',body,8,6)
        for side in (-1,1):
            mesh('Ear',[(side*.08,-.50,.76),(side*.19,-.45,.78),(side*.13,-.45,.99),(side*.08,-.40,.76)],[(0,1,2),(1,3,2),(3,0,2),(0,3,1)],col,body)
            mesh('InnerEar',[(side*.097,-.506,.79),(side*.17,-.465,.81),(side*.13,-.466,.94)],[(0,1,2)],'black',body)
        eye_pair('Eye',-.586,.73,.12,parent=body,r=.021)
        beam('Tail',(0,.30,.50),(.03,.74,.48),.12,col,body,8)
        cylinder('TailTip',(.03,.89,.48),.115,.31,'white',body,8,(math.pi/2,0,0),0)
    else:
        beam('Neck',(0,-.30,1.05),(0,-.47,1.49),.13,col,body,10)
        sphere('Head',(0,-.57,1.57),(.13,.22,.14),col,body)
        sphere('Muzzle',(0,-.74,1.52),(.11,.13,.085),light,body)
        sphere('Nose',(0,-.846,1.55),(.075,.027,.038),'black',body,8,6)
        for side in (-1,1):
            o=ico('Ear',(side*.20,-.50,1.70),(.16,.065,.075),light,body)
            o.rotation_euler.y=side*-.40
            beam('AntlerStem',(side*.073,-.44,1.68),(side*.14,-.39,2.02),.026,'wood_light',body)
            beam('AntlerTip',(side*.14,-.39,2.02),(side*.25,-.34,2.18),.017,'wood_light',body)
            beam('AntlerBranch',(side*.12,-.40,1.93),(side*.26,-.49,2.04),.016,'wood_light',body)
        eye_pair('Eye',-.654,1.62,.116,parent=body,r=.021)
        ico('Tail',(0,.56,1.03),(.07,.15,.10),'cream',body)
    legs=[]
    for side in (-1,1):
        for rear in (False,True):
            y=sy*.65 if rear else -sy*.65
            h=z-.09
            p=empty(kind.title()+('Rear' if rear else 'Front')+('L' if side<0 else 'R'),(side*sx*.8,y,h),ROOT)
            beam('UpperLeg',(0,0,0),(0,.03,-h*.55),.036 if isfox else .047,col,p)
            beam('LowerLeg',(0,.03,-h*.55),(0,0,-h+.045),.025 if isfox else .031,col,p)
            box('Paw' if isfox else 'Hoof',(0,-.016,-h+.027),(.073 if isfox else .09,.11,.055),'black',.009,p)
            legs.append((p,0 if (side<0)==rear else math.pi))
    walk(legs,.40 if isfox else .30)

def golfer():
    start('golfer','Stylized golfer with cap, orange polo, navy trousers and looping practice swing.',True)
    sphere('Head',(0,0,1.61),(.115,.105,.14),'skin')
    sphere('Cap',(0,0,1.72),(.125,.115,.066),'cream')
    box('CapBrim',(0,-.125,1.705),(.23,.16,.025),'cream',.02)
    box('Torso',(0,0,1.27),(.37,.23,.46),'orange',.06)
    cylinder('Neck',(0,0,1.48),.05,.12,'skin',vertices=8)
    for x in (-.10,.10):
        beam('TrouserLeg',(x,0,1.04),(x,.02,.12),.075,'navy',vertices=8)
        box('Shoe',(x,-.075,.065),(.16,.29,.12),'cream',.025)
    pivot=empty('SwingPivot',(0,-.09,1.36),ROOT)
    beam('LeftUpperArm',(-.20,0,-.04),(-.17,-.18,-.27),.055,'orange',pivot)
    beam('RightUpperArm',(.20,0,-.04),(.17,-.18,-.27),.055,'orange',pivot)
    for x in (-.17,.17):beam('Forearm',(x,-.18,-.27),(0,-.32,-.40),.041,'skin',pivot)
    sphere('Hands',(0,-.32,-.40),(.052,.05,.055),'skin',pivot)
    beam('ClubShaft',(0,-.34,-.40),(0,-.62,-1.27),.009,'silver',pivot)
    box('ClubHead',(.035,-.62,-1.27),(.14,.065,.05),'metal',.012,pivot)
    for f,a in [(1,0),(13,-1.0),(25,.18),(37,1.10),(49,0)]:
        pivot.rotation_euler.y=a;pivot.keyframe_insert(data_path='rotation_euler',frame=f)
    eye_pair('Eye',-.096,1.64,.048,r=.010)

def export_assets():
    manifest={'title':'Golf Range Simulator','style':'Original stylized low-poly',
        'coordinates':{'blender':'Z up, -Y forward','glb':'Y up, +Z forward','units':'metres'},
        'assets':[]}
    for a in ASSETS:
        scene=a['scene'];bpy.context.window.scene=scene;scene.frame_set(1)
        bpy.ops.object.select_all(action='DESELECT')
        for o in scene.objects:o.select_set(True)
        bpy.context.view_layer.objects.active=a['root']
        original_scene_name = scene.name
        if a['animated']: scene.name = 'PracticeSwing' if a['name']=='golfer' else 'Walk'
        bpy.ops.export_scene.gltf(filepath=str(OUT/(a['name']+'.glb')),export_format='GLB',
            use_selection=True,use_active_scene=True,export_extras=True,export_animations=a['animated'],
            export_animation_mode='SCENE',export_anim_scene_split_object=False,
            export_frame_range=True,export_force_sampling=True,
            export_nla_strips_merged_animation_name='Walk' if a['name']!='golfer' else 'PracticeSwing',
            export_cameras=False,export_lights=False)
        scene.name = original_scene_name
        meshes=[o for o in scene.objects if o.type=='MESH']
        tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
        points=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
        bounds=[min(p[i] for p in points) for i in range(3)]+[max(p[i] for p in points) for i in range(3)]
        manifest['assets'].append({'id':a['name'],'file':'models/'+a['name']+'.glb',
            'description':a['description'],'triangles_source':tris,'mesh_count':len(meshes),
            'bounds_blender':bounds,'animated':a['animated'],
            'animation':'PracticeSwing' if a['name']=='golfer' else ('Walk' if a['animated'] else None)})
    (BASE/'manifest.json').write_text(json.dumps(manifest,indent=2))

def copy_asset(name,loc=(0,0,0),scale=1,rotz=0):
    a=next(a for a in ASSETS if a['name']==name)
    copies={}
    for src in a['scene'].objects:
        cp=src.copy()
        cp.animation_data_clear()
        CURRENT.collection.objects.link(cp)
        copies[src]=cp
    for src,cp in copies.items():
        cp.parent=copies.get(src.parent)
        if not src.parent:
            cp.location=loc;cp.scale=(scale,)*3;cp.rotation_euler.z=rotz
    return copies[a['root']]

def aim(o,point):o.rotation_euler=(Vector(point)-o.location).to_track_quat('-Z','Y').to_euler()

def setup_showroom():
    global CURRENT,ROOT
    CURRENT=bpy.data.scenes.new('SHOWROOM | Golf Range Simulator')
    bpy.context.window.scene=CURRENT
    ROOT=empty('Showroom')
    engines = CURRENT.render.bl_rna.properties['engine'].enum_items.keys()
    CURRENT.render.engine = next(e for e in engines if 'EEVEE' in e)
    CURRENT.render.resolution_x=1600;CURRENT.render.resolution_y=1100
    CURRENT.render.resolution_percentage=100
    CURRENT.render.image_settings.file_format='PNG'
    CURRENT.world=bpy.data.worlds.new('Showroom sky')
    CURRENT.world.use_nodes=True
    CURRENT.world.node_tree.nodes.get('Background').inputs[0].default_value=(.32,.42,.48,1)
    CURRENT.world.node_tree.nodes.get('Background').inputs[1].default_value=.5
    CURRENT.view_settings.view_transform='AgX'
    box('StudioGround',(0,0,-.20),(200,200,.20),'grass_dark')
    for x,y,w,d in [(-4,-3,5.4,5.5),(2.5,-3,5.8,5.5),(-4,3,5.4,5),(2.5,3,5.8,5),(8.0,0,4.4,11.5)]:
        box('DisplayPlinth',(x,y,-.03),(w,d,.15),'grass',.10)
    copy_asset('tractor-picker',(-4,-2.8,.055),rotz=-.22)
    copy_asset('ball-depot',(2.5,-2.9,.055),scale=.88)
    copy_asset('hitting-bay',(-4,3,.055),scale=.90)
    copy_asset('golfer',(-4.25,2.5,.22),scale=.90)
    copy_asset('goose',(.7,1.4,.055),scale=1.18,rotz=-.3)
    copy_asset('fox',(2.2,2,.055),scale=1.12,rotz=-.4)
    copy_asset('deer',(3.9,3,.055),scale=1.05,rotz=-.35)
    copy_asset('tree-pine',(7.2,3.6,.055),scale=.87)
    copy_asset('tree-broadleaf',(8.7,3.3,.055),scale=.90)
    copy_asset('fence-section',(8.1,1.1,.055),scale=.85)
    copy_asset('target-flag',(7.1,-1.0,.055))
    for i,n in enumerate((50,100,150)):copy_asset('distance-marker-'+str(n),(7.9+(i%2)*1.0,-2.4-(i//2)*1.4,.055),scale=.68)
    copy_asset('golf-ball',(8.8,-.8,.08),scale=6)
    for label,loc,size in [('TRACTOR + PICKER',(-4,-5.23,.06),.30),('BALL RETURN',(2.5,-5.23,.06),.30),
        ('HITTING BAY',(-4,.72,.06),.30),('RANGE WILDLIFE',(2.5,.72,.06),.30),('RANGE PROPS',(8,-5.23,.06),.27)]:
        text('Label',label,loc,size,'cream',rot=(0,0,0))
    text('Title','GOLF RANGE SIMULATOR',(1,6.4,.01),.69,'cream',rot=(0,0,0))
    text('Subtitle','ORIGINAL 3D ASSET KIT / BLENDER + GLB',(1,5.65,.01),.26,'cream',rot=(0,0,0))
    sun=bpy.data.objects.new('Sun',bpy.data.lights.new('Sun','SUN'))
    CURRENT.collection.objects.link(sun);sun.rotation_euler=(.45,-.55,-.30);sun.data.energy=2.0;sun.data.angle=.12
    for name,loc,energy,size in [('Key',(-7,-8,12),1800,8),('Fill',(9,2,9),1300,7)]:
        o=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));CURRENT.collection.objects.link(o)
        o.location=loc;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;aim(o,(0,0,0))
    camera=bpy.data.objects.new('AssetCamera',bpy.data.cameras.new('AssetCamera'))
    CURRENT.collection.objects.link(camera);CURRENT.camera=camera
    camera.location=(16,-23,24);aim(camera,(1.4,.4,.35));camera.data.type='ORTHO';camera.data.ortho_scale=23.0
    return camera

def main():
    tractor();props();depot();bay();goose();quadruped('fox');quadruped('deer');golfer()
    export_assets()
    cam=setup_showroom()
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.type='MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
    CURRENT.render.filepath=str(PREVIEW/'asset-kit.png')
    bpy.ops.render.render(write_still=True)
    CURRENT.render.resolution_x=1200;CURRENT.render.resolution_y=900
    cam.location=(.4,-9,5);aim(cam,(-4,-3,1));cam.data.ortho_scale=6.2
    CURRENT.render.filepath=str(PREVIEW/'tractor-picker.png');bpy.ops.render.render(write_still=True)
    cam.location=(7,-5,4);aim(cam,(2.3,2.3,.7));cam.data.ortho_scale=5.6
    CURRENT.render.filepath=str(PREVIEW/'wildlife.png');bpy.ops.render.render(write_still=True)
    cam.location=(16,-23,24);aim(cam,(1.4,.4,.35));cam.data.ortho_scale=23.0
    CURRENT.render.resolution_x=1600;CURRENT.render.resolution_y=1100
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'blender'/'golf-range-assets.blend'),check_existing=False)
    (BASE/'BUILD_COMPLETE.json').write_text(json.dumps({'status':'complete','assets':len(ASSETS),'blender':bpy.app.version_string}))
    print('GOLF RANGE ASSETS COMPLETE:',len(ASSETS))

if __name__=='__main__':
    try:main()
    except Exception:
        (BASE/'BUILD_ERROR.txt').write_text(traceback.format_exc())
        raise

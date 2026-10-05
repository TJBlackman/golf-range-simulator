"""Discard unneeded tangent attributes from surfaces without normal maps.

Blender sometimes emits zero-length tangents for degenerate UV wedges on small
bevels. Materials without a normal map do not consume a tangent frame, so omitting
the unused attribute is correct and avoids validator errors. Normal-mapped
materials retain all tangent data. Embedded buffers and textures are untouched.
"""
import json
import struct
from pathlib import Path


def remove_unused_tangents(path):
    path=Path(path);data=path.read_bytes()
    json_length=struct.unpack_from('<I',data,12)[0]
    document=json.loads(data[20:20+json_length])
    for mesh in document.get('meshes',[]):
        for primitive in mesh['primitives']:
            material=document['materials'][primitive['material']]
            if 'normalTexture' not in material:
                primitive['attributes'].pop('TANGENT',None)
    encoded=json.dumps(document,separators=(',',':'),ensure_ascii=False).encode('utf8')
    encoded+=b' '*((-len(encoded))%4)
    remainder=data[20+json_length:]
    header=struct.pack('<III',0x46546C67,2,20+len(encoded)+len(remainder))
    path.write_bytes(header+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+remainder)


if __name__=='__main__':
    for path in (Path(__file__).resolve().parents[1]/'models').glob('*.glb'):
        remove_unused_tangents(path)

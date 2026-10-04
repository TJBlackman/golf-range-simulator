"""Package source, exports, previews, and QA without generated dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

base=Path(__file__).resolve().parents[1]
target=base.parent/'golf-range-assets.zip'
with ZipFile(target,'w',ZIP_DEFLATED) as archive:
    for file in sorted(base.rglob('*')):
        if not file.is_file(): continue
        relative=file.relative_to(base)
        if 'node_modules' in relative.parts or '__pycache__' in relative.parts: continue
        if file.suffix=='.blend1' or file.name.startswith(('BUILD_','EXPORT_')): continue
        archive.write(file,Path('golf-range-assets')/relative)
print(str(target))
print(f'{target.stat().st_size:,} bytes')

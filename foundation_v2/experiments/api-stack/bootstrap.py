"""Download verified portable toolchains into this experiment only."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'


def install(name, url, checksum, algorithm='sha256'):
    folder = RUNTIME / name
    if (folder / 'receipt.json').exists():
        return name + ': already verified'
    RUNTIME.mkdir(exist_ok=True)
    archive = RUNTIME / (name + '.zip')
    with urllib.request.urlopen(url, timeout=60) as response, archive.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    digest = hashlib.new(algorithm, archive.read_bytes()).hexdigest()
    if digest != checksum.lower():
        raise RuntimeError(name + ': checksum mismatch')
    folder.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            target = (folder / member.filename).resolve()
            if not target.is_relative_to(folder.resolve()):
                raise RuntimeError('archive escapes runtime')
        package.extractall(folder)
    (folder / 'receipt.json').write_text(json.dumps({'url': url, algorithm: digest}, indent=2))
    return name + ': checksum verified'


if __name__ == '__main__':
    go_url = 'https://go.dev/dl/go1.27.2.windows-amd64.zip'
    go_hash = '1314008898bd40df77af4b014f777f08873dbdfbcd3d92308728ee03304fe04f'
    java_url = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12.1-windows-x64.zip'
    java_hash = urllib.request.urlopen(java_url + '.sha256sum.txt').read().decode().split()[0]
    maven_url = 'https://dlcdn.apache.org/maven/maven-3/3.9.16/binaries/apache-maven-3.9.16-bin.zip'
    maven_hash = urllib.request.urlopen(maven_url.replace('dlcdn.', 'downloads.') + '.sha512').read().decode().split()[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(install, 'go', go_url, go_hash),
                   executor.submit(install, 'java', java_url, java_hash),
                   executor.submit(install, 'maven', maven_url, maven_hash, 'sha512')]
        for future in concurrent.futures.as_completed(futures):
            print(future.result(), flush=True)

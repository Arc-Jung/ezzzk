/**
 * `dist/` 를 CRX3 패키지로 묶는다.
 *
 * 왜 직접 만드는가: `chrome --pack-extension` 은 크롬 바이너리가 필요해 CI 가 무거워진다.
 * CRX3 는 "Cr24 헤더 + protobuf 서명 헤더 + zip" 구조라 Node 표준 모듈로 충분히 만들 수 있다.
 *
 * CRX3 레이아웃 (https://source.chromium.org/chromium/chromium/src/+/main:components/crx_file/)
 * ```
 * "Cr24"                     4B  매직
 * version = 3                4B  uint32 LE
 * headerLength               4B  uint32 LE
 * CrxFileHeader              protobuf
 * zip                        나머지 전체
 * ```
 * 서명 대상은 `"CRX3 SignedData\0" + uint32LE(len(signedHeaderData)) + signedHeaderData + zip` 이다.
 * 확장 ID 는 공개키 DER 의 SHA-256 앞 16바이트를 a~p 로 매핑한 값이다.
 *
 * ⚠️ **개인키는 절대 저장소에 넣지 않는다.** `.keys/` 는 gitignore 되어 있고,
 * CI 는 `CRX_PRIVATE_KEY`(base64 PEM) 시크릿으로 주입한다.
 * 키가 없으면 **임시 키를 만들어 쓰고 경고한다** — 그 경우 확장 ID 가 빌드마다 바뀌므로
 * 배포용으로 쓰면 안 된다.
 *
 * 실행: yarn build && yarn pack:crx
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const OUT_DIR = resolve(ROOT, 'release');
const KEY_DIR = resolve(ROOT, '.keys');
const KEY_PATH = resolve(KEY_DIR, 'ezzzk.pem');

/* ── protobuf 최소 인코더 (필요한 것은 length-delimited 필드뿐) ────────────── */

function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

/** 필드 번호 + wire type 2(length-delimited) 태그 */
function tag(fieldNumber) {
  return varint((fieldNumber << 3) | 2);
}

function field(fieldNumber, payload) {
  return Buffer.concat([tag(fieldNumber), varint(payload.length), payload]);
}

/* ── 키 ──────────────────────────────────────────────────────────────────── */

function loadPrivateKey() {
  const fromEnv = process.env.CRX_PRIVATE_KEY;
  if (fromEnv) {
    // CI 는 개행이 깨지지 않도록 base64 로 주입한다. 평문 PEM 도 받아 준다.
    const pem = fromEnv.includes('-----BEGIN')
      ? fromEnv
      : Buffer.from(fromEnv, 'base64').toString('utf8');
    return { key: createPrivateKey(pem), source: 'CRX_PRIVATE_KEY 시크릿', ephemeral: false };
  }

  if (existsSync(KEY_PATH)) {
    return { key: createPrivateKey(readFileSync(KEY_PATH)), source: KEY_PATH, ephemeral: false };
  }

  // 키가 없으면 만들어 둔다 — 다음 빌드부터 같은 확장 ID 를 유지할 수 있다.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_PATH, pem, { mode: 0o600 });
  return { key: createPrivateKey(pem), source: `${KEY_PATH} (새로 생성)`, ephemeral: true };
}

/** 확장 ID — 공개키 DER SHA-256 앞 16바이트를 a~p 로 매핑 */
function extensionId(publicKeyDer) {
  const digest = createHash('sha256').update(publicKeyDer).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .split('')
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(hex, 16)))
    .join('');
}

/* ── zip ─────────────────────────────────────────────────────────────────── */

/**
 * 패키지에서 제외할 것.
 * `.vite/` 는 Vite 의 빌드 매니페스트로 확장 실행에 쓰이지 않는다 — 패키지만 키우고
 * 빌드 구성을 불필요하게 노출한다. `.DS_Store` 는 macOS 에서 빌드할 때 섞인다.
 */
const ZIP_EXCLUDES = ['.vite/*', '.DS_Store', '*/.DS_Store'];

function makeZip(zipPath) {
  rmSync(zipPath, { force: true });
  // `zip` 은 macOS·ubuntu-latest 에 기본 포함이다. `-X` 로 불필요한 확장 필드를 뺀다.
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', ...ZIP_EXCLUDES], {
    cwd: DIST,
    stdio: 'inherit',
  });
  return readFileSync(zipPath);
}

/* ── CRX3 ────────────────────────────────────────────────────────────────── */

function buildCrx(zipBuffer, privateKey) {
  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const id = extensionId(publicKeyDer);

  // SignedData { bytes crx_id = 1 }
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId);

  // 서명 대상 = 매직 문자열 + signedHeaderData 길이 + signedHeaderData + zip
  const signer = createSign('sha256');
  signer.update(Buffer.from('CRX3 SignedData\0', 'binary'));
  const lengthLe = Buffer.alloc(4);
  lengthLe.writeUInt32LE(signedHeaderData.length, 0);
  signer.update(lengthLe);
  signer.update(signedHeaderData);
  signer.update(zipBuffer);
  const signature = signer.sign(privateKey);

  // AsymmetricKeyProof { public_key = 1, signature = 2 }
  const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)]);
  // CrxFileHeader { sha256_with_rsa = 2, signed_header_data = 10000 }
  const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)]);

  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'binary');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);

  return { crx: Buffer.concat([prefix, header, zipBuffer]), id, publicKeyDer };
}

/* ── 자기 검증 ───────────────────────────────────────────────────────────── */

/**
 * 만든 crx 를 되읽어 구조와 서명을 확인한다.
 * ⚠️ 이것은 **형식 검증**이다. "크롬이 실제로 설치를 받아 주는가"는 수동 드래그앤드롭으로만
 * 확인할 수 있으므로 여기서 통과했다고 설치 성공을 보장하지는 않는다.
 */
function verifyCrx(crx, expectedZip, publicKeyDer, privateKey) {
  const problems = [];
  if (crx.subarray(0, 4).toString('binary') !== 'Cr24') problems.push('매직이 Cr24 가 아니다');
  const version = crx.readUInt32LE(4);
  if (version !== 3) problems.push(`버전이 3 이 아니다 (${version})`);

  const headerLength = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLength);
  const zip = crx.subarray(12 + headerLength);

  if (!zip.equals(expectedZip)) problems.push('zip 본문이 일치하지 않는다');
  if (!header.includes(publicKeyDer)) problems.push('헤더에 공개키가 없다');
  if (zip.subarray(0, 2).toString('binary') !== 'PK') problems.push('zip 시그니처(PK)가 아니다');

  /**
   * 🔴 구조 검사만으로는 부족하다 — 서명 **입력**이 틀려도 구조는 통과한다.
   * 헤더에서 signedHeaderData 와 signature 를 되꺼내 실제로 검증한다.
   */
  const signedHeaderData = extractSignedHeaderData(header);
  const signature = extractSignature(header, publicKeyDer);
  if (!signedHeaderData) problems.push('헤더에서 signed_header_data 를 찾지 못했다');
  if (!signature) problems.push('헤더에서 signature 를 찾지 못했다');

  if (signedHeaderData && signature) {
    const verifier = createVerify('sha256');
    verifier.update(Buffer.from('CRX3 SignedData\0', 'binary'));
    const lengthLe = Buffer.alloc(4);
    lengthLe.writeUInt32LE(signedHeaderData.length, 0);
    verifier.update(lengthLe);
    verifier.update(signedHeaderData);
    verifier.update(zip);
    if (!verifier.verify(createPublicKey(privateKey), signature)) {
      problems.push('서명이 검증되지 않는다 (서명 입력이 규격과 다르다)');
    }
  }

  return problems;
}

/** 헤더에서 field 10000(signed_header_data) 를 되꺼낸다. */
function extractSignedHeaderData(header) {
  const marker = tag(10000);
  const at = header.indexOf(marker);
  if (at < 0) return null;
  let cursor = at + marker.length;
  let length = 0;
  let shift = 0;
  for (;;) {
    const byte = header[cursor];
    if (byte === undefined) return null;
    cursor += 1;
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return header.subarray(cursor, cursor + length);
}

/** proof 안의 field 2(signature) 를 되꺼낸다. 공개키 바로 뒤에 온다. */
function extractSignature(header, publicKeyDer) {
  const keyAt = header.indexOf(publicKeyDer);
  if (keyAt < 0) return null;
  let cursor = keyAt + publicKeyDer.length;
  if (!header.subarray(cursor, cursor + 1).equals(tag(2))) return null;
  cursor += 1;
  let length = 0;
  let shift = 0;
  for (;;) {
    const byte = header[cursor];
    if (byte === undefined) return null;
    cursor += 1;
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return header.subarray(cursor, cursor + length);
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  if (!existsSync(resolve(DIST, 'manifest.json'))) {
    console.error('[crx] dist/manifest.json 이 없다. 먼저 `yarn build` 를 실행한다.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(resolve(DIST, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    console.error(
      `[crx] 버전 불일치: manifest.json=${manifest.version} package.json=${pkg.version}`,
    );
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const base = `ezzzk-${manifest.version}`;
  const zipPath = resolve(OUT_DIR, `${base}.zip`);
  const crxPath = resolve(OUT_DIR, `${base}.crx`);

  const zipBuffer = makeZip(zipPath);
  const { key, source, ephemeral } = loadPrivateKey();
  const { crx, id, publicKeyDer } = buildCrx(zipBuffer, key);

  const problems = verifyCrx(crx, zipBuffer, publicKeyDer, key);
  if (problems.length > 0) {
    console.error('[crx] 자기 검증 실패:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  writeFileSync(crxPath, crx);

  console.info(`[crx] 이름       ${manifest.name}`);
  console.info(`[crx] 버전       ${manifest.version}`);
  console.info(`[crx] 확장 ID    ${id}`);
  console.info(`[crx] 키         ${source}`);
  console.info(`[crx] zip        ${zipPath} (${zipBuffer.length.toLocaleString()} B)`);
  console.info(`[crx] crx        ${crxPath} (${crx.length.toLocaleString()} B)`);
  console.info('[crx] 형식 검증  PASS (매직·버전·공개키·zip 본문·**서명 검증**)');

  if (ephemeral) {
    console.warn(
      '[crx] ⚠️ 개인키가 없어 새로 만들었다. `.keys/ezzzk.pem` 을 안전한 곳에 백업한다 — ' +
        '키가 바뀌면 확장 ID 도 바뀌어 기존 설치와 다른 확장으로 취급된다.',
    );
  }
  console.info(
    '[crx] ⚠️ 위 검증은 형식 검증이다. 크롬이 설치를 받아 주는지는 ' +
      'chrome://extensions 에 crx 를 드래그앤드롭해 직접 확인한다.',
  );
}

main();

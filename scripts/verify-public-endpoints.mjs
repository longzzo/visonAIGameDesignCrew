import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGAL_URL_FIELDS = ["websiteUrl", "privacyUrl", "termsUrl", "refundPolicyUrl", "supportPolicyUrl"];

const cleanYamlValue = (value) => String(value || "").trim().replace(/^['"]|['"]$/g, "");

export function parseLatestManifest(text) {
  const source = String(text || "");
  return {
    version: cleanYamlValue(source.match(/^version:\s*(.+?)\s*$/m)?.[1]),
    path: cleanYamlValue(source.match(/^path:\s*(.+?)\s*$/m)?.[1]),
    sha512: cleanYamlValue(source.match(/^sha512:\s*(\S+)\s*$/m)?.[1]),
    size: Number(source.match(/^\s*size:\s*(\d+)\s*$/m)?.[1] || 0),
  };
}

async function checkedFetch(url, { fetchImpl, method = "GET", timeoutMs = 20_000 } = {}) {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:") throw new Error(`HTTPS 주소가 아닙니다: ${parsed}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Vision-Engine-Release-Verification/1" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (new URL(response.url || parsed).protocol !== "https:") throw new Error("최종 응답이 HTTPS가 아닙니다.");
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyLegalUrls(product, fetchImpl) {
  const results = {};
  const errors = [];
  for (const field of LEGAL_URL_FIELDS) {
    const url = String(product?.[field] || "").trim();
    if (!url) {
      errors.push(`${field}: 주소가 비어 있습니다.`);
      results[field] = { ok: false, url };
      continue;
    }
    try {
      const response = await checkedFetch(url, { fetchImpl });
      results[field] = { ok: true, url, status: response.status, finalUrl: response.url || url };
      await response.body?.cancel?.();
    } catch (error) {
      const message = String(error?.message || error).slice(0, 180);
      errors.push(`${field}: 공개 접근 실패 (${message})`);
      results[field] = { ok: false, url, error: message };
    }
  }
  return { results, errors };
}

async function verifyUpdateChannel(product, expectedVersion, fetchImpl) {
  const errors = [];
  const baseUrl = String(product?.updateUrl || "").trim();
  if (product?.updatesEnabled !== true) errors.push("updatesEnabled가 true가 아닙니다.");
  if (!baseUrl) return { ok: false, baseUrl, errors: [...errors, "updateUrl이 비어 있습니다."] };
  try {
    const manifestUrl = new URL("latest.yml", baseUrl).toString();
    const manifestResponse = await checkedFetch(manifestUrl, { fetchImpl });
    const declaredLength = Number(manifestResponse.headers.get("content-length") || 0);
    if (declaredLength > 1_000_000) throw new Error("latest.yml이 1MB를 초과합니다.");
    const manifestText = await manifestResponse.text();
    if (manifestText.length > 1_000_000) throw new Error("latest.yml이 1MB를 초과합니다.");
    const manifest = parseLatestManifest(manifestText);
    if (!manifest.version || !manifest.path || !manifest.sha512 || manifest.size <= 0) errors.push("latest.yml 필수 필드가 불완전합니다.");
    if (expectedVersion && manifest.version !== expectedVersion) errors.push(`latest.yml 버전 불일치: ${manifest.version || "없음"} / ${expectedVersion}`);
    if (manifest.path && (manifest.path.includes("/") || manifest.path.includes("\\") || manifest.path.includes(".."))) errors.push("latest.yml 설치 파일 경로가 안전하지 않습니다.");

    const assets = {};
    if (manifest.path && !errors.some((item) => item.includes("경로가 안전하지"))) {
      for (const name of [manifest.path, `${manifest.path}.blockmap`]) {
        const assetUrl = new URL(name, baseUrl).toString();
        try {
          const response = await checkedFetch(assetUrl, { fetchImpl, method: "HEAD" });
          const bytes = Number(response.headers.get("content-length") || 0);
          assets[name] = { ok: true, status: response.status, bytes, finalUrl: response.url || assetUrl };
          if (name === manifest.path && bytes > 0 && bytes !== manifest.size) errors.push(`설치 파일 크기 불일치: ${bytes} / ${manifest.size}`);
          await response.body?.cancel?.();
        } catch (error) {
          const message = String(error?.message || error).slice(0, 180);
          errors.push(`${name}: 공개 접근 실패 (${message})`);
          assets[name] = { ok: false, error: message };
        }
      }
    }
    return { ok: errors.length === 0, baseUrl, manifestUrl, manifest, assets, errors };
  } catch (error) {
    errors.push(`latest.yml 공개 접근 실패 (${String(error?.message || error).slice(0, 180)})`);
    return { ok: false, baseUrl, errors };
  }
}

export async function verifyPublicEndpoints({ product, expectedVersion = "", legalOnly = false, fetchImpl = fetch } = {}) {
  const legal = await verifyLegalUrls(product || {}, fetchImpl);
  const update = legalOnly ? { ok: true, skipped: true, errors: [] } : await verifyUpdateChannel(product || {}, expectedVersion, fetchImpl);
  const errors = [...legal.errors, ...update.errors];
  return { ok: errors.length === 0, expectedVersion, legal: legal.results, update, errors };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  const product = JSON.parse(fs.readFileSync(path.join(root, "config", "product.json"), "utf-8").replace(/^\uFEFF/, ""));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, "desktop", "package.json"), "utf-8").replace(/^\uFEFF/, ""));
  const expectedVersion = argumentValue("--expect-version") || String(desktopPackage.version || "");
  const legalOnly = process.argv.includes("--legal-only");
  const attempts = legalOnly ? 1 : 4;
  let report;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    report = await verifyPublicEndpoints({ product, expectedVersion, legalOnly });
    report.attempt = attempt;
    if (report.ok || attempt === attempts) break;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

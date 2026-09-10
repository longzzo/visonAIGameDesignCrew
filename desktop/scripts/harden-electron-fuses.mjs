import path from "node:path";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

/**
 * electron-builder가 아직 모르는 최신 Electron Fuse까지 전부 명시한다.
 * strictlyRequireAllFuses 덕분에 Electron 업그레이드로 새 Fuse가 생기면 빌드를 중단한다.
 */
export default async function hardenElectronFuses(context) {
  const extension = context.electronPlatformName === "win32" ? ".exe" : "";
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}${extension}`);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
}

/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { wrapInASCIIBox } from '@utils/ascii';
import { hostPlatform, isOfficiallySupportedPlatform } from '@utils/hostPlatform';
import { getLinuxDistributionInfoSync } from '@utils/linuxUtils';
import { spawnAsync } from '@utils/spawnAsync';
import { getPlaywrightVersion } from '../userAgent';
import { deps } from './nativeDeps';

import { packageJSON, binPath } from '../../package';
import { buildPlaywrightCLICommand, registry } from '.';

const languageBindingVersion = process.env.PW_CLI_DISPLAY_VERSION || packageJSON.version;

const dockerVersionFilePath = '/ms-playwright/.docker-info';
export async function writeDockerVersion(dockerImageNameTemplate: string) {
  await fs.promises.mkdir(path.dirname(dockerVersionFilePath), { recursive: true });
  await fs.promises.writeFile(dockerVersionFilePath, JSON.stringify(dockerVersion(dockerImageNameTemplate), null, 2), 'utf8');
  // Make sure version file is globally accessible.
  await fs.promises.chmod(dockerVersionFilePath, 0o777);
}

export function dockerVersion(dockerImageNameTemplate: string): { driverVersion: string, dockerImageName: string } {
  return {
    driverVersion: languageBindingVersion,
    dockerImageName: dockerImageNameTemplate.replace('%version%', languageBindingVersion),
  };
}

export function readDockerVersionSync(): null | { driverVersion: string, dockerImageName: string, dockerImageNameTemplate: string } {
  try {
    const data = JSON.parse(fs.readFileSync(dockerVersionFilePath, 'utf8'));
    return {
      ...data,
      dockerImageNameTemplate: data.dockerImageName.replace(data.driverVersion, '%version%'),
    };
  } catch (e) {
    return null;
  }
}

const checkExecutable = (filePath: string) => {
  if (process.platform === 'win32')
    return filePath.endsWith('.exe');
  return fs.promises.access(filePath, fs.constants.X_OK).then(() => true).catch(() => false);
};

function isSupportedWindowsVersion(): boolean {
  if (os.platform() !== 'win32' || os.arch() !== 'x64')
    return false;
  const [major, minor] = os.release().split('.').map(token => parseInt(token, 10));
  // This is based on: https://stackoverflow.com/questions/42524606/how-to-get-windows-version-using-node-js/44916050#44916050
  // The table with versions is taken from: https://docs.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-osversioninfoexw#remarks
  // Windows 7 is not supported and is encoded as `6.1`.
  return major > 6 || (major === 6 && minor > 1);
}

export type DependencyGroup = 'chromium' | 'firefox' | 'webkit' | 'tools';

type LinuxDistributionFamily = 'debian' | 'arch';

const TIME64_SUFFIX = 't64';
const ARCH_LINUX_IDS = new Set(['arch', 'archlinux']);

const ARCH_PACKAGE_NAME_MAP: { [key: string]: string | undefined } = {
  'xvfb': 'xorg-server-xvfb',
  'fonts-noto-color-emoji': 'noto-fonts-emoji',
  'fonts-liberation': 'ttf-liberation',
  'xfonts-cyrillic': 'xorg-fonts-cyrillic',
  'fonts-freefont-ttf': 'gnu-free-fonts',
  'libfontconfig1': 'fontconfig',
  'libfreetype6': 'freetype2',
  'libasound2': 'alsa-lib',
  'libatk-bridge2.0-0': 'at-spi2-core',
  'libatk1.0-0': 'atk',
  'libatspi2.0-0': 'at-spi2-core',
  'libavcodec60': 'ffmpeg',
  'libavif13': 'libavif',
  'libavif15': 'libavif',
  'libavif16': 'libavif',
  'libcairo-gobject2': 'cairo',
  'libcairo2': 'cairo',
  'libcups2': 'cups',
  'libdbus-1-3': 'dbus',
  'libdbus-glib-1-2': 'dbus-glib',
  'libdrm2': 'libdrm',
  'libegl1': 'libglvnd',
  'libenchant-2-2': 'enchant',
  'libepoxy0': 'libepoxy',
  'libevent-2.1-7': 'libevent',
  'libffi7': 'libffi',
  'libflite1': 'flite',
  'libgdk-pixbuf-2.0-0': 'gdk-pixbuf2',
  'libgdk-pixbuf2.0-0': 'gdk-pixbuf2',
  'libgbm1': 'mesa',
  'libgl1': 'libglvnd',
  'libgles2': 'libglvnd',
  'libgstreamer-gl1.0-0': 'gst-plugins-base',
  'libgstreamer-plugins-bad1.0-0': 'gst-plugins-bad',
  'libgstreamer-plugins-base1.0-0': 'gst-plugins-base',
  'libgstreamer1.0-0': 'gstreamer',
  'libgudev-1.0-0': 'libgudev',
  'libglib2.0-0': 'glib2',
  'libgtk-3-0': 'gtk3',
  'libgtk-4-1': 'gtk4',
  'libharfbuzz-icu0': 'harfbuzz',
  'libharfbuzz0b': 'harfbuzz',
  'libhyphen0': 'hyphen',
  'libicu66': 'icu',
  'libicu67': 'icu',
  'libicu70': 'icu',
  'libicu72': 'icu',
  'libicu74': 'icu',
  'libicu76': 'icu',
  'libjpeg-turbo8': 'libjpeg-turbo',
  'libjpeg62-turbo': 'libjpeg-turbo',
  'liblcms2-2': 'lcms2',
  'libmanette-0.2-0': 'libmanette',
  'libnghttp2-14': 'nghttp2',
  'libnotify4': 'libnotify',
  'libnss3': 'nss',
  'libnspr4': 'nspr',
  'libopenjp2-7': 'openjpeg2',
  'libopengl0': 'libglvnd',
  'libopus0': 'opus',
  'libpango-1.0-0': 'pango',
  'libpangocairo-1.0-0': 'pango',
  'libpangoft2-1.0-0': 'pango',
  'libpng16-16': 'libpng',
  'libproxy1v5': 'libproxy',
  'libsecret-1-0': 'libsecret',
  'libsoup-3.0-0': 'libsoup3',
  'libvpx6': 'libvpx',
  'libvpx7': 'libvpx',
  'libvpx9': 'libvpx',
  'libwayland-client0': 'wayland',
  'libwayland-egl1': 'wayland',
  'libwayland-server0': 'wayland',
  'libwebp6': 'libwebp',
  'libwebp7': 'libwebp',
  'libwebpdemux2': 'libwebp',
  'libwoff1': 'woff2',
  'libx11-6': 'libx11',
  'libx11-xcb1': 'libx11',
  'libx264-155': 'x264',
  'libx264-163': 'x264',
  'libx264-164': 'x264',
  'libxcb-dri3-0': 'libxcb',
  'libxcb-shm0': 'libxcb',
  'libxcb1': 'libxcb',
  'libxcomposite1': 'libxcomposite',
  'libxcursor1': 'libxcursor',
  'libxdamage1': 'libxdamage',
  'libxext6': 'libxext',
  'libxfixes3': 'libxfixes',
  'libxi6': 'libxi',
  'libxkbcommon0': 'libxkbcommon',
  'libxshmfence1': 'libxshmfence',
  'libxml2': 'libxml2',
  'libxrandr2': 'libxrandr',
  'libxrender1': 'libxrender',
  'libxslt1.1': 'libxslt',
  'libxt6': 'libxt',
  'libxtst6': 'libxtst',
  'libatomic1': 'gcc-libs',
  'gstreamer1.0-libav': 'gst-libav',
  'gstreamer1.0-plugins-bad': 'gst-plugins-bad',
  'gstreamer1.0-plugins-base': 'gst-plugins-base',
  'gstreamer1.0-plugins-good': 'gst-plugins-good',
  'libglx0': 'libglvnd',
};

function collectDependencyPackages(targets: Set<DependencyGroup>, platform: string): string[] | undefined {
  const info = deps[platform];
  if (!info) {
    console.warn(`Cannot install dependencies for ${platform} with Playwright ${getPlaywrightVersion()}!`);  // eslint-disable-line no-console
    return undefined;
  }
  const packages: string[] = [];
  for (const target of targets)
    packages.push(...info[target]);
  return Array.from(new Set(packages));
}

function detectLinuxDistributionFamily(): LinuxDistributionFamily | undefined {
  const distroInfo = getLinuxDistributionInfoSync();
  if (!distroInfo)
    return undefined;
  if (distroInfo.id === 'debian' || distroInfo.idLike.includes('debian'))
    return 'debian';
  if (ARCH_LINUX_IDS.has(distroInfo.id) || distroInfo.idLike.some(id => ARCH_LINUX_IDS.has(id)))
    return 'arch';
  return undefined;
}

function translatePackageNameForArchLinux(packageName: string): string | undefined {
  const translated = ARCH_PACKAGE_NAME_MAP[packageName];
  if (translated)
    return translated;
  if (!packageName.endsWith(TIME64_SUFFIX))
    return undefined;
  const normalizedPackageName = packageName.substring(0, packageName.length - TIME64_SUFFIX.length);
  const normalizedTranslated = ARCH_PACKAGE_NAME_MAP[normalizedPackageName];
  if (normalizedTranslated)
    return normalizedTranslated;
  if (/^libicu\d+$/.test(normalizedPackageName))
    return 'icu';
  if (/^libvpx\d+$/.test(normalizedPackageName))
    return 'libvpx';
  if (/^libwebp\d+$/.test(normalizedPackageName))
    return 'libwebp';
  if (/^libx264-\d+$/.test(normalizedPackageName))
    return 'x264';
  return undefined;
}

function translatePackagesForArchLinux(packages: string[]): string[] {
  const translatedPackages = new Set<string>();
  const skippedPackages = new Set<string>();
  for (const packageName of packages) {
    const translatedPackage = translatePackageNameForArchLinux(packageName);
    if (translatedPackage)
      translatedPackages.add(translatedPackage);
    else
      skippedPackages.add(packageName);
  }
  if (skippedPackages.size) {
    // eslint-disable-next-line no-console
    console.warn(`Skipping packages without a known Arch Linux translation: ${[...skippedPackages].sort().join(', ')}`);
  }
  return [...translatedPackages];
}

export async function installDependenciesWindows(targets: Set<DependencyGroup>, dryRun: boolean): Promise<void> {
  if (targets.has('chromium')) {
    const command = 'powershell.exe';
    const args = ['-ExecutionPolicy', 'Bypass', '-File', path.join(binPath, 'install_media_pack.ps1')];
    if (dryRun) {
      console.log(`${command} ${quoteProcessArgs(args).join(' ')}`); // eslint-disable-line no-console
      return;
    }
    const { code } = await spawnAsync(command, args, { cwd: binPath, stdio: 'inherit' });
    if (code !== 0)
      throw new Error('Failed to install windows dependencies!');
  }
}

export async function installDependenciesLinux(targets: Set<DependencyGroup>, dryRun: boolean) {
  if (!isOfficiallySupportedPlatform)
    console.warn(`BEWARE: your OS is not officially supported by Playwright; installing dependencies for ${hostPlatform} as a fallback.`); // eslint-disable-line no-console
  const family = detectLinuxDistributionFamily();
  if (family === 'arch') {
    await installDependenciesArchLinux(targets, dryRun);
    return;
  }
  if (family === 'debian') {
    await installDependenciesDebian(targets, dryRun);
    return;
  }
  console.warn(`Cannot install dependencies for ${hostPlatform} on this Linux distribution with Playwright ${getPlaywrightVersion()}!`);  // eslint-disable-line no-console
}

async function installDependenciesDebian(targets: Set<DependencyGroup>, dryRun: boolean) {
  const uniqueLibraries = collectDependencyPackages(targets, hostPlatform);
  if (!uniqueLibraries)
    return;
  if (dryRun) {
    await reportMissingDependenciesLinux(uniqueLibraries);
    return;
  }
  console.log(`Installing dependencies...`);  // eslint-disable-line no-console
  const commands: string[] = [];
  commands.push('apt-get update');
  commands.push(['apt-get', 'install', '-y', '--no-install-recommends',
    ...uniqueLibraries,
  ].join(' '));
  const { command, args, elevatedPermissions } = await transformCommandsForRoot(commands);
  if (elevatedPermissions)
    console.log('Switching to root user to install dependencies...'); // eslint-disable-line no-console
  const child = childProcess.spawn(command, args, { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code: number) => code === 0 ? resolve() : reject(new Error(`Installation process exited with code: ${code}`)));
    child.on('error', reject);
  });
}

async function installDependenciesArchLinux(targets: Set<DependencyGroup>, dryRun: boolean) {
  const uniqueLibraries = collectDependencyPackages(targets, hostPlatform);
  if (!uniqueLibraries)
    return;
  const translatedLibraries = translatePackagesForArchLinux(uniqueLibraries);
  if (!translatedLibraries.length) {
    console.warn(`No Arch Linux package translations were found for Playwright ${getPlaywrightVersion()}.`); // eslint-disable-line no-console
    return;
  }
  if (dryRun) {
    await reportMissingDependenciesArchLinux(translatedLibraries);
    return;
  }
  console.log(`Installing dependencies...`); // eslint-disable-line no-console
  const commands = [['pacman', '-S', '--noconfirm', '--needed', ...translatedLibraries].join(' ')];
  const { command, args, elevatedPermissions } = await transformCommandsForRoot(commands);
  if (elevatedPermissions)
    console.log('Switching to root user to install dependencies...'); // eslint-disable-line no-console
  const child = childProcess.spawn(command, args, { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code: number) => code === 0 ? resolve() : reject(new Error(`Installation process exited with code: ${code}`)));
    child.on('error', reject);
  });
}

async function reportMissingDependenciesLinux(packages: string[]) {
  // `apt-get install -s` simulates the install: it does not need root and does not
  // modify the system. Stdout includes one `Inst <package> ...` line per package
  // that would be installed (i.e. that is currently missing).
  const { code, stdout, stderr, error } = await spawnAsync('apt-get', ['install', '-s', '--no-install-recommends', ...packages], {});
  if (error)
    throw new Error(`Failed to run 'apt-get install -s' to simulate dependency install: ${error.message}`);
  if (code !== 0)
    throw new Error(`'apt-get install -s' exited with code ${code}:\n${stderr || stdout}`);
  const missingPackages: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^Inst (\S+) /.exec(line);
    if (match)
      missingPackages.push(match[1]);
  }
  if (!missingPackages.length) {
    console.log('All system dependencies are installed.'); // eslint-disable-line no-console
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Missing system dependencies (${missingPackages.length}):\n${missingPackages.sort().map(p => `  ${p}`).join('\n')}`);
  process.exitCode = 1;
}

async function reportMissingDependenciesArchLinux(packages: string[]) {
  const { code, stdout, stderr, error } = await spawnAsync('pacman', ['-T', ...packages], {});
  if (error)
    throw new Error(`Failed to run 'pacman -T' to simulate dependency install: ${error.message}`);
  const missingPackages = stdout.split('\n').map(line => line.trim()).filter(Boolean);
  if (!missingPackages.length) {
    if (code !== 0)
      throw new Error(`'pacman -T' exited with code ${code}:\n${[stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || 'no output'}`);
    console.log('All system dependencies are installed.'); // eslint-disable-line no-console
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Missing system dependencies (${missingPackages.length}):\n${missingPackages.sort().map(p => `  ${p}`).join('\n')}`);
  process.exitCode = 1;
}

export async function validateDependenciesWindows(sdkLanguage: string, windowsExeAndDllDirectories: string[]) {
  const directoryPaths = windowsExeAndDllDirectories;
  const lddPaths: string[] = [];
  for (const directoryPath of directoryPaths)
    lddPaths.push(...(await executablesOrSharedLibraries(directoryPath)));
  const allMissingDeps = await Promise.all(lddPaths.map(lddPath => missingFileDependenciesWindows(sdkLanguage, lddPath)));
  const missingDeps: Set<string> = new Set();
  for (const deps of allMissingDeps) {
    for (const dep of deps)
      missingDeps.add(dep);
  }

  if (!missingDeps.size)
    return;

  let isCrtMissing = false;
  let isMediaFoundationMissing = false;
  for (const dep of missingDeps) {
    if (dep.startsWith('api-ms-win-crt') || dep === 'vcruntime140.dll' || dep === 'vcruntime140_1.dll' || dep === 'msvcp140.dll')
      isCrtMissing = true;
    else if (dep === 'mf.dll' || dep === 'mfplat.dll' ||  dep === 'msmpeg2vdec.dll' || dep === 'evr.dll' || dep === 'avrt.dll')
      isMediaFoundationMissing = true;
  }

  const details = [];

  if (isCrtMissing) {
    details.push(
        `Some of the Universal C Runtime files cannot be found on the system. You can fix`,
        `that by installing Microsoft Visual C++ Redistributable for Visual Studio from:`,
        `https://support.microsoft.com/en-us/help/2977003/the-latest-supported-visual-c-downloads`,
        ``);
  }

  if (isMediaFoundationMissing) {
    details.push(
        `Some of the Media Foundation files cannot be found on the system. If you are`,
        `on Windows Server try fixing this by running the following command in PowerShell`,
        `as Administrator:`,
        ``,
        `    Install-WindowsFeature Server-Media-Foundation`,
        ``,
        `For Windows N editions visit:`,
        `https://support.microsoft.com/en-us/help/3145500/media-feature-pack-list-for-windows-n-editions`,
        ``);
  }

  details.push(
      `Full list of missing libraries:`,
      `    ${[...missingDeps].join('\n    ')}`,
      ``);

  const message = `Host system is missing dependencies!\n\n${details.join('\n')}`;
  if (isSupportedWindowsVersion()) {
    throw new Error(message);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`WARNING: running on unsupported windows version!`);
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

export async function validateDependenciesLinux(sdkLanguage: string, linuxLddDirectories: string[], dlOpenLibraries: string[]) {
  const directoryPaths = linuxLddDirectories;
  const lddPaths: string[] = [];
  for (const directoryPath of directoryPaths)
    lddPaths.push(...(await executablesOrSharedLibraries(directoryPath)));
  const missingDepsPerFile = await Promise.all(lddPaths.map(lddPath => missingFileDependencies(lddPath, directoryPaths)));
  const missingDeps: Set<string> = new Set();
  for (const deps of missingDepsPerFile) {
    for (const dep of deps)
      missingDeps.add(dep);
  }
  for (const dep of (await missingDLOPENLibraries(dlOpenLibraries)))
    missingDeps.add(dep);
  if (!missingDeps.size)
    return;
  const allMissingDeps = new Set(missingDeps);
  // Check Ubuntu version.
  const missingPackages = new Set();

  const libraryToPackageNameMapping = deps[hostPlatform] ? {
    ...(deps[hostPlatform]?.lib2package || {}),
    ...MANUAL_LIBRARY_TO_PACKAGE_NAME_UBUNTU,
  } : {};
  // Translate missing dependencies to package names to install with apt.
  for (const missingDep of missingDeps) {
    const packageName = libraryToPackageNameMapping[missingDep];
    if (packageName) {
      missingPackages.add(packageName);
      missingDeps.delete(missingDep);
    }
  }

  const maybeSudo = process.getuid?.() && os.platform() !== 'win32' ? 'sudo ' : '';
  const dockerInfo = readDockerVersionSync();
  const errorLines = [
    `Host system is missing dependencies to run browsers.`,
  ];
  // Ignore patch versions when comparing docker container version and Playwright version:
  // we **NEVER** roll browsers in patch releases, so native dependencies do not change.
  if (dockerInfo && !dockerInfo.driverVersion.startsWith(getPlaywrightVersion(true /* majorMinorOnly */) + '.')) {
    // We are running in a docker container with unmatching version.
    // In this case, we know how to install dependencies in it.
    const pwVersion = getPlaywrightVersion();
    const requiredDockerImage = dockerInfo.dockerImageName.replace(dockerInfo.driverVersion, pwVersion);
    errorLines.push(...[
      `This is most likely due to Docker image version not matching Playwright version:`,
      `- Playwright  : ${pwVersion}`,
      `- Docker image: ${dockerInfo.driverVersion}`,
      ``,
      `Either:`,
      `- (recommended) use Docker image "${requiredDockerImage}"`,
      `- (alternative 1) run the following command inside Docker to install missing dependencies:`,
      ``,
      `    ${maybeSudo}${buildPlaywrightCLICommand(sdkLanguage, 'install-deps')}`,
      ``,
      `- (alternative 2) use apt inside Docker:`,
      ``,
      `    ${maybeSudo}apt-get install ${[...missingPackages].join('\\\n        ')}`,
      ``,
      `<3 Playwright Team`,
    ]);
  } else if (missingPackages.size && !missingDeps.size) {
    // Only known dependencies are missing for browsers.
    // Suggest installation with a Playwright CLI.
    errorLines.push(...[
      `Please install them with the following command:`,
      ``,
      `    ${maybeSudo}${buildPlaywrightCLICommand(sdkLanguage, 'install-deps')}`,
      ``,
      `Alternatively, use apt:`,
      `    ${maybeSudo}apt-get install ${[...missingPackages].join('\\\n        ')}`,
      ``,
      `<3 Playwright Team`,
    ]);
  } else {
    // Unhappy path: we either run on unknown distribution, or we failed to resolve all missing
    // libraries to package names.
    // Print missing libraries only:
    errorLines.push(...[
      `Missing libraries:`,
      ...[...allMissingDeps].map(dep => '    ' + dep),
    ]);
  }

  throw new Error('\n' + wrapInASCIIBox(errorLines.join('\n'), 1));
}

function isSharedLib(basename: string) {
  switch (os.platform()) {
    case 'linux':
      return basename.endsWith('.so') || basename.includes('.so.');
    case 'win32':
      return basename.endsWith('.dll');
    default:
      return false;
  }
}

async function executablesOrSharedLibraries(directoryPath: string): Promise<string[]> {
  if (!fs.existsSync(directoryPath))
    return [];
  const allPaths = (await fs.promises.readdir(directoryPath)).map(file => path.resolve(directoryPath, file));
  const allStats = await Promise.all(allPaths.map(aPath => fs.promises.stat(aPath)));
  const filePaths = allPaths.filter((aPath, index) => (allStats[index] as any).isFile());

  const executablersOrLibraries = (await Promise.all(filePaths.map(async filePath => {
    const basename = path.basename(filePath).toLowerCase();
    if (isSharedLib(basename))
      return filePath;
    if (await checkExecutable(filePath))
      return filePath;
    return false;
  }))).filter(Boolean);

  return executablersOrLibraries as string[];
}

async function missingFileDependenciesWindows(sdkLanguage: string, filePath: string): Promise<Array<string>> {
  const executable = registry.findExecutable('winldd')!.executablePathOrDie(sdkLanguage);
  const dirname = path.dirname(filePath);
  const { stdout, code } = await spawnAsync(executable, [filePath], {
    cwd: dirname,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ? `${process.env.LD_LIBRARY_PATH}:${dirname}` : dirname,
    },
  });
  if (code !== 0)
    return [];
  const missingDeps = stdout.split('\n').map(line => line.trim()).filter(line => line.endsWith('not found') && line.includes('=>')).map(line => line.split('=>')[0].trim().toLowerCase());
  return missingDeps;
}

async function missingFileDependencies(filePath: string, extraLDPaths: string[]): Promise<Array<string>> {
  const dirname = path.dirname(filePath);
  let LD_LIBRARY_PATH = extraLDPaths.join(':');
  if (process.env.LD_LIBRARY_PATH)
    LD_LIBRARY_PATH = `${process.env.LD_LIBRARY_PATH}:${LD_LIBRARY_PATH}`;
  const { stdout, code } = await spawnAsync('ldd', [filePath], {
    cwd: dirname,
    env: {
      ...process.env,
      LD_LIBRARY_PATH,
    },
  });
  if (code !== 0)
    return [];
  const missingDeps = stdout.split('\n').map(line => line.trim()).filter(line => line.endsWith('not found') && line.includes('=>')).map(line => line.split('=>')[0].trim());
  return missingDeps;
}

async function missingDLOPENLibraries(libraries: string[]): Promise<string[]> {
  if (!libraries.length)
    return [];
  // NOTE: Using full-qualified path to `ldconfig` since `/sbin` is not part of the
  // default PATH in CRON.
  // @see https://github.com/microsoft/playwright/issues/3397
  const { stdout, code, error } = await spawnAsync('/sbin/ldconfig', ['-p'], {});
  if (code !== 0 || error)
    return [];
  const isLibraryAvailable = (library: string) => stdout.toLowerCase().includes(library.toLowerCase());
  return libraries.filter(library => !isLibraryAvailable(library));
}

const MANUAL_LIBRARY_TO_PACKAGE_NAME_UBUNTU: { [s: string]: string} = {
  // libgstlibav.so (the only actual library provided by gstreamer1.0-libav) is not
  // in the ldconfig cache, so we detect the actual library required for playing h.264
  // and if it's missing recommend installing missing gstreamer lib.
  // gstreamer1.0-libav -> libavcodec57 -> libx264-152
  'libx264.so': 'gstreamer1.0-libav',
};

function quoteProcessArgs(args: string[]): string[] {
  return args.map(arg => {
    if (arg.includes(' '))
      return `"${arg}"`;
    return arg;
  });
}

export async function transformCommandsForRoot(commands: string[]): Promise<{ command: string, args: string[], elevatedPermissions: boolean}> {
  const isRoot = process.getuid?.() === 0;
  if (isRoot)
    return { command: 'sh', args: ['-c', `${commands.join('&& ')}`], elevatedPermissions: false };
  const sudoExists = await spawnAsync('which', ['sudo']);
  if (sudoExists.code === 0)
    return { command: 'sudo', args: ['--', 'sh', '-c', `${commands.join('&& ')}`], elevatedPermissions: true };
  return { command: 'su', args: ['root', '-c', `${commands.join('&& ')}`], elevatedPermissions: true };
}

import path from 'node:path';
import type { PackageCheck, PackageInfo } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { ProcessRunnerPort } from '../ports/process-runner.js';

export class PackageService {
  constructor(private readonly fs: FileSystemPort, private readonly runner: ProcessRunnerPort, private readonly projectRoot: string) {}

  readPackageInfo(packageJsonPath = path.join(this.projectRoot, 'package.json')): PackageInfo {
    return JSON.parse(this.fs.readText(packageJsonPath)) as PackageInfo;
  }

  check(packageJsonPath = path.join(this.projectRoot, 'package.json')): PackageCheck {
    const info = this.readPackageInfo(packageJsonPath);
    const warnings: string[] = [];
    if (info.name !== '@shenysun/skills-manager') warnings.push(`Package name is ${info.name || '<missing>'}, expected @shenysun/skills-manager`);
    const bin = typeof info.bin === 'string' ? { [info.name || '']: info.bin } : (info.bin || {});
    if (!('skills-manager' in bin)) warnings.push('Missing skills-manager binary in package.json bin');
    if (info.private) warnings.push('Package is marked private');
    if (!info.files?.includes('dist')) warnings.push('Package files should include dist');
    return { ok: warnings.length === 0, packageJsonPath, info, warnings };
  }

  packDryRun() {
    const result = this.runner.run('npm', ['pack', '--dry-run', '--json'], { cwd: this.projectRoot });
    return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
  }
}

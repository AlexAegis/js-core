import type { Options } from 'globby';

import { join } from 'node:path/posix';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mockProjectRoot } from '../../__mocks__/fs.js';

import { PackageJson, PACKAGE_JSON_NAME } from '../const/package-json.interface.js';
import { collectWorkspacePackages } from './collect-workspace-packages.function.js';

const mockPackageJsonValue: PackageJson = {
	name: 'name',
};

vi.mock('@alexaegis/fs', async () => {
	const mockReadJson = vi.fn<[string | undefined], Promise<unknown>>(async (path) => {
		if (path?.endsWith(PACKAGE_JSON_NAME)) {
			return mockPackageJsonValue;
		} else {
			return undefined;
		}
	});

	const mockReadYaml = vi.fn<[string | undefined], Promise<unknown>>(async (_path) => {
		return undefined;
	});

	return {
		readJson: mockReadJson,
		readYaml: mockReadYaml,
		normalizeCwdOption: await vi
			.importActual<typeof import('@alexaegis/fs')>('@alexaegis/fs')
			.then((mod) => mod.normalizeCwdOption),
	};
});

vi.mock('node:fs', async () => {
	return {
		existsSync: vi.fn((path: string) => {
			return path === join(mockProjectRoot, PACKAGE_JSON_NAME);
		}),
	};
});

vi.mock('globby', () => {
	return {
		globby: (_patterns: string[], options: Options): string[] => {
			expect(options.absolute).toBeTruthy();
			expect(options.onlyDirectories).toBeTruthy();
			expect(options.cwd).toBe('/foo/bar');
			return [];
		},
	};
});

describe('collectWorkspacePackages in a root-package only workspace', () => {
	afterAll(() => {
		vi.resetAllMocks();
	});

	it('should be able to collect all packages in a workspace from a sub directory', async () => {
		const foundPackageJsons = await collectWorkspacePackages({ cwd: '/foo/bar/zed' });
		expect(foundPackageJsons).toEqual([
			{ packageJson: mockPackageJsonValue, path: '/foo/bar' },
		]);
	});

	it('should be able to collect all packages in a workspace from the root', async () => {
		const foundPackageJsons = await collectWorkspacePackages({ cwd: '/foo/bar' });
		expect(foundPackageJsons).toEqual([
			{ packageJson: mockPackageJsonValue, path: '/foo/bar' },
		]);
	});

	it('should be able to collect nothing, outside the workspace', async () => {
		const foundPackageJsons = await collectWorkspacePackages({ cwd: '/foo' });
		expect(foundPackageJsons).toEqual([]);
	});
});

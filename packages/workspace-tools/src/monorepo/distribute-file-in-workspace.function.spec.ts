import { mockLogger } from '@alexaegis/logging/mocks';
import { join, sep } from 'node:path/posix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockProjectRoot } from '../../__mocks__/fs.js';
import {
	cpMock,
	mkdirMock,
	readFileMock,
	rmMock,
	symlinkMock,
	writeFileMock,
} from '../../__mocks__/node:fs/promises.js';
import type { PackageJson } from '../index.js';
import {
	distributeFileInWorkspace,
	DISTRIBUTION_MARK,
} from './distribute-file-in-workspace.function.js';

const mockTurnIntoExecutable = vi.fn<[string | undefined], Promise<unknown>>();

vi.mock('globby');
vi.mock('fs');
vi.mock('node:fs/promises');
vi.mock('@alexaegis/fs', async () => {
	const mockReadJson = vi.fn<[string | undefined], Promise<unknown>>(async (_path) => {
		// For some reason the file cannot be read even though it exists
		return {
			workspaces: ['packages/*'],
		} as PackageJson;
	});

	const mockReadYaml = vi.fn<[string | undefined], Promise<unknown>>(async (_path) => {
		return undefined;
	});

	return {
		readJson: mockReadJson,
		readYaml: mockReadYaml,
		turnIntoExecutable: vi.fn<[string | undefined], Promise<unknown>>(async (path) => {
			return mockTurnIntoExecutable(path);
		}),
		normalizeCwdOption: await vi
			.importActual<typeof import('@alexaegis/fs')>('@alexaegis/fs')
			.then((mod) => mod.normalizeCwdOption),
		toAbsolute: await vi
			.importActual<typeof import('@alexaegis/fs')>('@alexaegis/fs')
			.then((mod) => mod.toAbsolute),
	};
});

describe('distributeFile', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('sould expose DISTRIBUTION_MARK', () => {
		expect(DISTRIBUTION_MARK).toBeTruthy();
	});

	describe('workspace', () => {
		it('should immediately return if cwd is not in a workspace', async () => {
			const filename = '/foo/bar/packages/rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, '..'),
			});

			expect(readFileMock).not.toHaveBeenCalled();
			expect(writeFileMock).not.toHaveBeenCalled();
			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});
	});

	describe('copy', () => {
		it('should copy to all folders when not dry', async () => {
			const filename = '/foo/bar/packages/rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
			});

			expect(readFileMock).toHaveBeenCalledWith('/foo/bar/packages/zed/rcfile');

			expect(readFileMock).toHaveBeenCalledWith(filename);
			expect(writeFileMock).toHaveBeenCalledWith(
				'/foo/bar/packages/zod/rcfile',
				'content ../..'
			);

			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/rcfile', 'content .');

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should not copy to any folders when dry', async () => {
			const filename = '/foo/bar/packages/rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				dry: true,
			});

			expect(cpMock).not.toHaveBeenCalledWith();
			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
			expect(mkdirMock).not.toHaveBeenCalled();
		});

		it('should create folders before if necessary', async () => {
			const filename = '/foo/bar/packages/rcfile';
			await distributeFileInWorkspace(filename, 'foo/rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
			});

			expect(mkdirMock).toHaveBeenCalledWith('/foo/bar/foo');
			expect(mkdirMock).toHaveBeenCalledWith('/foo/bar/packages/zed/foo');
			expect(mkdirMock).toHaveBeenCalledWith('/foo/bar/packages/zod/foo');

			expect(readFileMock).toHaveBeenCalledWith(filename);
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/foo/rcfile', 'content .');
			expect(writeFileMock).toHaveBeenCalledWith(
				'/foo/bar/packages/zed/foo/rcfile',
				'content ../..'
			);
			expect(writeFileMock).toHaveBeenCalledWith(
				'/foo/bar/packages/zod/foo/rcfile',
				'content ../..'
			);

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should not copy even if there is a file already there that is not autogenerated', async () => {
			const filename = '/foo/bar/packages/rcfile';
			readFileMock.mockImplementation(async (path) => {
				if (path.toString().endsWith('zed/rcfile')) {
					return 'hello custom world!';
				} else {
					return undefined;
				}
			});

			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				skipWorkspaceRoot: true,
			});

			expect(readFileMock).toHaveBeenCalledWith(filename);
			expect(writeFileMock).not.toHaveBeenCalledWith(
				'/foo/bar/packages/zed/rcfile',
				expect.anything()
			);
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/packages/zod/rcfile', '');

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should copy even if there is a file already there but it is autogenerated', async () => {
			const filename = '/foo/bar/packages/rcfile';
			readFileMock.mockImplementation(async (path) => {
				if (path.toString().endsWith('zed/rcfile')) {
					return `${DISTRIBUTION_MARK}\nhello auto world!`;
				} else {
					return undefined;
				}
			});

			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				skipWorkspaceRoot: true,
			});

			expect(readFileMock).toHaveBeenCalledWith(filename);
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/packages/zed/rcfile', '');
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/packages/zod/rcfile', '');

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();

			expect(mockTurnIntoExecutable).not.toHaveBeenCalled();
		});

		it('should log an error if it fails and there is a logger', async () => {
			writeFileMock.mockRejectedValueOnce('ERROR');

			const filename = '/foo/bar/packages/rcfile';

			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				logger: mockLogger,
			});

			expect(mockLogger.error).toHaveBeenCalled();
			expect(cpMock).not.toHaveBeenCalledWith();
			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should also mark the file as executable when enabled', async () => {
			const filename = '/foo/bar/packages/rcfile';
			readFileMock.mockImplementation(async (path) => {
				if (path.toString().endsWith('zed/rcfile')) {
					return `${DISTRIBUTION_MARK}\nhello auto world!`;
				} else {
					return undefined;
				}
			});

			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				skipWorkspaceRoot: true,
				markAsExecutable: true,
			});

			expect(readFileMock).toHaveBeenCalledWith(filename);
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/packages/zed/rcfile', '');
			expect(writeFileMock).toHaveBeenCalledWith('/foo/bar/packages/zod/rcfile', '');

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();

			expect(mockTurnIntoExecutable).toHaveBeenCalled();
		});
	});

	describe('force', () => {
		it('should remove existing files when force is used and is not a dry run', async () => {
			const filename = 'rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				force: true,
			});
			expect(rmMock).toHaveBeenCalled();
		});

		it('should not remove existing files even when force is used but it is a dry run', async () => {
			const filename = 'rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				force: true,
				dry: true,
			});

			expect(rmMock).not.toHaveBeenCalled();
		});
	});

	describe('symlinking', () => {
		it('should symlink to all folders', async () => {
			const filename = 'rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				symlinkInsteadOfCopy: true,
			});

			expect(symlinkMock).toHaveBeenCalledWith(
				`packages${sep}${filename}`,
				join(mockProjectRoot, filename)
			);
			expect(symlinkMock).toHaveBeenCalledTimes(1);
			expect(cpMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should not symlink to any folders when dry', async () => {
			const filename = 'rcfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				symlinkInsteadOfCopy: true,
				dry: true,
			});

			expect(symlinkMock).not.toHaveBeenCalled();
			expect(cpMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should refuse to link something thats nonexistent', async () => {
			const filename = 'nonexistent';
			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				symlinkInsteadOfCopy: true,
			});

			expect(symlinkMock).toHaveBeenCalledTimes(0);
			expect(cpMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should refuse to link something thats not a file', async () => {
			const filename = 'nonfile';
			await distributeFileInWorkspace(filename, 'rcfile', {
				dependencyCriteria: ['@dep'],
				cwd: join(mockProjectRoot, 'packages'),
				symlinkInsteadOfCopy: true,
			});

			expect(symlinkMock).toHaveBeenCalledTimes(0);
			expect(cpMock).not.toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});

		it('should log an error if it fails and there is a logger', async () => {
			symlinkMock.mockRejectedValueOnce('ERROR');

			const filename = '/foo/bar/packages/rcfile';

			await distributeFileInWorkspace(filename, 'rcfile', {
				cwd: join(mockProjectRoot, 'packages'),
				logger: mockLogger,
				symlinkInsteadOfCopy: true,
			});

			expect(mockLogger.error).toHaveBeenCalled();
			expect(cpMock).not.toHaveBeenCalledWith();
			expect(symlinkMock).toHaveBeenCalled();
			expect(rmMock).not.toHaveBeenCalled();
		});
	});
});

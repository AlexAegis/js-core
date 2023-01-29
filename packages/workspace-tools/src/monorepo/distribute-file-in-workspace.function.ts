import { dry } from '@alexaegis/common';
import { existsSync } from 'node:fs';
import { cp, lstat, readFile, rm, symlink } from 'node:fs/promises';

import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { collectWorkspacePackages } from './collect-workspace-packages.function.js';
import {
	DistributeFileInWorkspaceOptions,
	normalizeDistributeFileInWorkspaceOptions,
} from './distribute-file-in-workspace.function.options.js';

// TODO: Remove this once this is resolved https://github.com/bcoe/c8/issues/434
/* c8 ignore next */
export const DISTRIBUTION_MARK = 'autogenerated';

export const distributeFileInWorkspace = async (
	file: string,
	rawOptions?: DistributeFileInWorkspaceOptions
): Promise<void> => {
	const options = normalizeDistributeFileInWorkspaceOptions(rawOptions);
	const filePath = isAbsolute(file) ? file : join(options.cwd, file);

	const fileName = basename(filePath);

	if (!existsSync(filePath)) {
		options.logger.error(`can't distribute '${file}', it doesn't exist`);
		return;
	}

	const fileStats = await lstat(filePath);

	if (!fileStats.isFile()) {
		options.logger.error(`can't distribute '${file}', it's not a file`);
		return;
	}

	const targetPackages = await collectWorkspacePackages(options);

	options.logger.log(
		`packages to check:\n\t${targetPackages
			.map((packageJson) => './' + relative(options.cwd, packageJson.path))
			.join('\n\t')}`
	);

	const targetStats = await Promise.all(
		targetPackages
			.map((targetPackage) => join(targetPackage.path, fileName))
			.map((path) =>
				lstat(path)
					.then((stats) => ({ stats, path }))
					.catch(() => ({ stats: false, path }))
			)
	);

	if (options.force) {
		options.logger.log('force option used, removing all targets before distribution...');
		await Promise.all(
			targetStats.map((target) => {
				if (target.stats && !options.dry) {
					return rm(target.path).catch(() => undefined);
				} else {
					return undefined;
				}
			})
		);
	}
	let validTargets: string[];
	if (options?.symlinkInsteadOfCopy) {
		validTargets = targetStats.filter((target) => !target.stats).map((target) => target.path);
	} else {
		// valid if doesnt exist, or a symlink, or its content has an autogenerated mark
		const validPaths = await Promise.all(
			targetStats.map((target) =>
				typeof target.stats === 'object' && !target.stats.isSymbolicLink()
					? readFile(target.path, { encoding: 'utf8' })
							.catch(() => undefined)
							.then((content) => {
								return content?.includes(DISTRIBUTION_MARK)
									? target.path
									: undefined;
							})
					: target.path
			)
		);
		validTargets = validPaths.filter((path): path is string => !!path);
	}

	await Promise.all(
		validTargets.map((targetFilepath) => {
			if (options.symlinkInsteadOfCopy) {
				const relativeFromTargetBackToFile = relative(dirname(targetFilepath), filePath);
				return (options.dry ? dry() : symlink(relativeFromTargetBackToFile, targetFilepath))
					.then(() => {
						options.logger.log(
							`symlinked ${targetFilepath} to ${relativeFromTargetBackToFile}`
						);
					})
					.catch((error: string) => {
						options.logger.error(`can't link ${file}, error happened: ${error}`);
					});
			} else {
				return (options.dry ? dry() : cp(filePath, targetFilepath))
					.then(() => {
						options.logger.log(`copied ${filePath} to ${targetFilepath}`);
					})
					.catch((error: string) => {
						options.logger.error(`can't copy ${file}, error happened ${error}`);
					});
			}
		})
	);
};

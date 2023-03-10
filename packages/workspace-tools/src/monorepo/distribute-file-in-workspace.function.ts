import { asyncFilter, dry, fillStringWithTemplateVariables } from '@alexaegis/common';
import { toAbsolute, turnIntoExecutable } from '@alexaegis/fs';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';

import { dirname, join, relative } from 'node:path';
import { getWorkspaceRoot } from '../npm/get-workspace-root.function.js';
import { getPackageJsonTemplateVariables } from '../package-json/get-package-json-template-variables.function.js';
import type { WorkspacePackage } from '../package-json/workspace-package.interface.js';
import { collectWorkspacePackages } from './collect-workspace-packages.function.js';
import {
	DistributeFileInWorkspaceOptions,
	normalizeDistributeFileInWorkspaceOptions,
} from './distribute-file-in-workspace.function.options.js';
import { isDistributedFile } from './is-distributed-file.function.js';

export const DISTRIBUTION_MARK = 'autogenerated';

type WorkspaceFileTarget = { absolutePathToTargetFile: string; targetPackage: WorkspacePackage };

/**
 * Takes a file relative to cwd then distributes it along the workspace
 * based on the targetFile path relative to the package it's distributing to.
 *
 * It also substitutes the following variables in the files being distributed:
 *   - ${relativePathFromPackageToRoot} => '../../' (or '.' in the case of the root package)
 *   - ${packageName}
 *   - ${packageOrg}
 *   - ${packageNameWithoutOrg}
 *
 * This is only available when files are copied and not symlinked.
 */
export const distributeFileInWorkspace = async (
	sourceFile: string,
	targetFile: string,
	rawOptions?: DistributeFileInWorkspaceOptions
): Promise<void> => {
	const options = normalizeDistributeFileInWorkspaceOptions(rawOptions);
	const absoluteSourceFilePath = toAbsolute(sourceFile, options);
	const workspaceRoot = await getWorkspaceRoot(options.cwd);

	if (!workspaceRoot) {
		options.logger.error(`can't distribute '${sourceFile}', not in a workspace!`);
		return;
	}

	if (!existsSync(absoluteSourceFilePath)) {
		options.logger.error(`can't distribute '${sourceFile}', it doesn't exist`);
		return;
	}

	const fileStats = await lstat(absoluteSourceFilePath);

	if (!fileStats.isFile()) {
		options.logger.error(`can't distribute '${sourceFile}', it's not a file`);
		return;
	}

	const targetPackages = await collectWorkspacePackages(options);

	options.logger.info(
		`packages to check:\n\t${targetPackages
			.map((packageJson) => './' + relative(options.cwd, packageJson.path))
			.join('\n\t')}`
	);

	const targetStats = await Promise.all(
		targetPackages
			.map((targetPackage) => ({
				targetPackage,
				absolutePathToTargetFile: join(targetPackage.path, targetFile),
			}))
			.map(({ absolutePathToTargetFile, targetPackage }) =>
				lstat(absolutePathToTargetFile)
					.then((stats) => ({ stats, absolutePathToTargetFile, targetPackage }))
					.catch(() => ({ stats: false, absolutePathToTargetFile, targetPackage }))
			)
	);

	if (options.force) {
		options.logger.info('force option used, removing all targets before distribution...');
		await Promise.all(
			targetStats.map((target) => {
				if (target.stats && !options.dry) {
					return rm(target.absolutePathToTargetFile).catch(() => undefined);
				} else {
					return undefined;
				}
			})
		);
	}

	let validTargets: WorkspaceFileTarget[];

	if (options?.symlinkInsteadOfCopy) {
		validTargets = targetStats.filter((target) => !target.stats);
	} else {
		// valid if doesn't exist, or a symlink, or its content has an autogenerated mark

		validTargets = await asyncFilter(targetStats, async (target) =>
			typeof target.stats === 'object' && !target.stats.isSymbolicLink()
				? isDistributedFile(target.absolutePathToTargetFile)
				: true
		);
	}

	const driedMkdir = dry(options.dry, mkdir);

	// make sure target folders exist
	await Promise.all(
		validTargets.map((target) =>
			driedMkdir(dirname(target.absolutePathToTargetFile), { recursive: true })
		)
	);

	if (options.symlinkInsteadOfCopy) {
		await Promise.all(
			validTargets.map((target) => {
				const relativeFromTargetBackToFile = relative(
					dirname(target.absolutePathToTargetFile),
					absoluteSourceFilePath
				);

				const driedSymlink = dry(options.dry, symlink);

				return driedSymlink(relativeFromTargetBackToFile, target.absolutePathToTargetFile)
					.then(() => {
						options.logger.debug(
							`symlinked ${target} to ${relativeFromTargetBackToFile}`
						);
					})
					.catch((error: string) => {
						options.logger.error(`can't link ${sourceFile}, error happened: ${error}`);
					});
			})
		);
	} else {
		const sourceFileContent =
			(await readFile(absoluteSourceFilePath, { encoding: 'utf8' })) || '';

		await Promise.all(
			validTargets.map((target) => {
				const variables = getPackageJsonTemplateVariables(target.targetPackage.packageJson);
				variables['relativePathFromPackageToRoot'] =
					relative(target.targetPackage.path, workspaceRoot) || '.';
				Object.assign(variables, options.templateVariables);

				const transformedContent = options.transformers.reduce(
					(content, transformer) => transformer(content),
					sourceFileContent
				);

				const driedWriteFile = dry(options.dry, writeFile);
				return driedWriteFile(
					target.absolutePathToTargetFile,
					fillStringWithTemplateVariables(transformedContent, variables)
				)
					.then(() => {
						options.logger.debug(
							`copied ${relative(
								workspaceRoot,
								absoluteSourceFilePath
							)} to ${relative(workspaceRoot, target.absolutePathToTargetFile)}`
						);
					})
					.catch((error: string) => {
						options.logger.error(`can't copy ${sourceFile}, error happened ${error}`);
					});
			})
		);
	}

	if (options.markAsExecutable) {
		await Promise.all(
			validTargets.map((target) => {
				const driedTurnIntoExecutable = dry(options.dry, turnIntoExecutable);
				return driedTurnIntoExecutable(target.absolutePathToTargetFile, options);
			})
		);
	}
};

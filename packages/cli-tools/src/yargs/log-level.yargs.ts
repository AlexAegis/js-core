import type { LogLevelOption } from '@alexaegis/logging';
import { isLogLevelEnumKey, isLogLevelEnumValue, LogLevel } from '@alexaegis/logging';
import type { Argv, MiddlewareFunction } from 'yargs';

export const yargsForLogLevelOption = <T>(yargs: Argv<T>): Argv<T & LogLevelOption> => {
	const logLevelYargs = yargs
		.option('logLevel', {
			alias: 'll',
			choices: Object.values(LogLevel),
			description: 'Minimum logLevel',
			conflicts: ['silent', 'verbose'],
			requiresArg: true,
			coerce: (value: string): LogLevel => {
				const i = Number.parseInt(value, 10);
				if (!Number.isNaN(i) && isLogLevelEnumValue(i)) {
					return i;
				} else if (isLogLevelEnumKey(value)) {
					return LogLevel[value];
				} else {
					return LogLevel.INFO;
				}
			},
		})
		.option('quiet', {
			alias: ['q', 'silent'],
			description: 'Turn off logging',
			boolean: true,
			conflicts: ['logLevel', 'verbose'],
		})
		.option('verbose', {
			alias: 'v',
			description: 'Turn on (almost) all logging',
			boolean: true,
			conflicts: ['logLevel', 'silent'],
		});
	// Middleware looks like is not typed well in @types/yargs
	return logLevelYargs.middleware(((args: Awaited<typeof logLevelYargs.argv>) => {
		if (args.quiet) {
			return { logLevel: LogLevel.OFF };
		} else if (args.verbose) {
			return { logLevel: LogLevel.TRACE };
		}
	}) as MiddlewareFunction);
};
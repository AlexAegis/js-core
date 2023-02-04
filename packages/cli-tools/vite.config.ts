import { defineConfig } from 'vite';
import { autolib } from 'vite-plugin-autolib';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		autolib(),
		dts({
			entryRoot: 'src',
		}),
	],
	build: {
		lib: {
			entry: './src/index.ts',
			formats: ['es', 'cjs'],
		},
	},
});

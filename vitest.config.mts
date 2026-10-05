import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// `obsidian` ships types only and `electron` is provided by the app;
		// tests run against small shims.
		alias: {
			obsidian: fileURLToPath(new URL('./tests/obsidian-shim.ts', import.meta.url)),
			electron: fileURLToPath(new URL('./tests/electron-shim.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		testTimeout: 20000,
	},
});

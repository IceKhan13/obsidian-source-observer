import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// The `obsidian` package ships types only; UI tests run against a small shim.
		alias: { obsidian: fileURLToPath(new URL('./tests/obsidian-shim.ts', import.meta.url)) },
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		testTimeout: 20000,
	},
});

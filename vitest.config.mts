import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Isolate process.chdir() used to test native default .env loading.
		pool: "forks",
		include: ["test/**/*.test.ts"],
	},
});

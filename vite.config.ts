import { defineConfig } from "vite";

export default defineConfig({
	root: "app",
	clearScreen: false,
	build: {
		outDir: "../dist",
		emptyOutDir: true,
		target: "esnext",
		sourcemap: true,
	},
	worker: {
		format: "es",
	},
	server: {
		host: "127.0.0.1",
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
	preview: {
		host: "127.0.0.1",
		port: 1421,
		strictPort: true,
	},
});

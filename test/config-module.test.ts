import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModule, DIContext, type ModuleDef } from "awilixify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ConfigService,
	createConfigModuleFactory,
	type RootConfigService,
} from "../index.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

function envFile(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "awilixify-config-"));
	directories.push(dir);
	const path = join(dir, ".env");
	writeFileSync(path, contents);
	return path;
}

function app(module: Parameters<typeof DIContext.create>[0]["imports"]) {
	return DIContext.create({ name: "App", imports: module });
}

describe("ConfigModuleFactory", () => {
	it("shares validated config across root and restricted child modules", async () => {
		const validate = vi.fn(() => ({
			host: "localhost",
			port: 3000,
			secret: "private",
		}));
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate,
		});
		const webConfig = ConfigModule({ keys: ["host", "port"] });
		type WebDef = ModuleDef<{ imports: [typeof webConfig] }>;
		const context = app([
			ConfigModule,
			createModule<WebDef>({ name: "Web", imports: [webConfig] }),
			ConfigModule({ keys: ["port"] }),
		]);
		const root =
			context.scope.resolve<RootConfigService<ReturnType<typeof validate>>>(
				"rootConfig",
			);
		expect(root.get("port")).toBe(3000);
		expect(validate).toHaveBeenCalledTimes(1);
		await context.init();
		const web = context.importedScopes.get("Web");
		const config =
			web?.scope.resolve<ConfigService<{ host: string; port: number }>>(
				"config",
			);
		expect(root.get()).toEqual({
			host: "localhost",
			port: 3000,
			secret: "private",
		});
		expect(config?.get()).toEqual({ host: "localhost", port: 3000 });
		expect(config?.get("port")).toBe(3000);
		// @ts-expect-error Unselected values must also throw at runtime.
		expect(() => config?.get("secret")).toThrow(
			'Configuration key "secret" is not allowed in this scope',
		);
		expect(web?.scope.hasRegistration("rootConfig")).toBe(false);
		expect(
			context.scope.resolve<ConfigService<{ port: number }>>("config").get(),
		).toEqual({ port: 3000 });
		expect(validate).toHaveBeenCalledTimes(1);
		expect(webConfig.imports).toEqual([ConfigModule]);
		await context.close();
	});

	it("makes scoped configuration available to a consumer's onInit", async () => {
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate: () => ({ port: 3000 }),
		});
		const WebConfig = ConfigModule({ keys: ["port"] });
		const initialized = vi.fn();
		type WebDef = ModuleDef<{
			imports: [typeof WebConfig];
			providers: { serverAddress: { onInit(): void } };
		}>;
		const WebModule = createModule<WebDef>({
			name: "Web",
			imports: [WebConfig],
			providers: {
				serverAddress: {
					inject: ["config"],
					useFactory: (config) => ({
						onInit() {
							initialized(config.get("port"));
						},
					}),
					eager: true,
				},
			},
		});
		const context = app([WebModule]);
		await context.init();
		expect(initialized).toHaveBeenCalledWith(3000);
		await context.close();
	});

	it("initializes through a child import alone and allows an empty key selection", async () => {
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate: () => ({ port: 3000 }),
		});
		const context = app([ConfigModule({ keys: [] })]);
		await context.init();
		expect(
			context.scope.resolve<ConfigService<object>>("config").get(),
		).toEqual({});
		expect(context.scope.hasRegistration("rootConfig")).toBe(false);
		await context.close();
	});

	it("loads files in priority order, then applies process.env without modifying it", async () => {
		vi.stubEnv("AWILIXIFY_CONFIG_TEST_OVERRIDE", "environment");
		vi.stubEnv("AWILIXIFY_CONFIG_TEST_FILE_ONLY", undefined);
		const first = envFile(
			'AWILIXIFY_CONFIG_TEST_OVERRIDE=file\nAWILIXIFY_CONFIG_TEST_FILE_ONLY=first\nQUOTED="hello # world"\nMULTILINE="line1\nline2"',
		);
		const second = envFile(
			"AWILIXIFY_CONFIG_TEST_FILE_ONLY=second\nSECOND_ONLY=yes",
		);
		const ConfigModule = createConfigModuleFactory({
			envFilePath: [first, second],
			validate: (env) => env,
		});
		const context = app([ConfigModule]);
		await context.init();
		expect(
			context.scope
				.resolve<RootConfigService<Record<string, string>>>("rootConfig")
				.get(),
		).toMatchObject({
			AWILIXIFY_CONFIG_TEST_OVERRIDE: "environment",
			AWILIXIFY_CONFIG_TEST_FILE_ONLY: "first",
			SECOND_ONLY: "yes",
			QUOTED: "hello # world",
			MULTILINE: "line1\nline2",
		});
		expect(process.env.AWILIXIFY_CONFIG_TEST_FILE_ONLY).toBeUndefined();
		await context.close();
	});

	it("supports a single path and ignores process.env when requested", async () => {
		const ConfigModule = createConfigModuleFactory({
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Expansion must stay literal.
			envFilePath: envFile("PORT=3000\nURL=${HOST}/api"),
			ignoreEnvVars: true,
			validate: (env) => env,
		});
		const context = app([ConfigModule]);
		await context.init();
		expect(
			context.scope.resolve<RootConfigService<object>>("rootConfig").get(),
		).toEqual({
			PORT: "3000",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Expansion must stay literal.
			URL: "${HOST}/api",
		});
		await context.close();
	});

	it("skips file loading when requested", async () => {
		const ConfigModule = createConfigModuleFactory({
			envFilePath: envFile("PORT=3000"),
			ignoreEnvFile: true,
			ignoreEnvVars: true,
			validate: (env) => env,
		});
		const context = app([ConfigModule]);
		await context.init();
		expect(
			context.scope.resolve<RootConfigService<object>>("rootConfig").get(),
		).toEqual({});
		await context.close();
	});

	it("ignores missing files but propagates other filesystem errors", async () => {
		const file = envFile("PORT=3000");
		const ConfigModule = createConfigModuleFactory({
			envFilePath: [join(file, "..", "missing"), file],
			ignoreEnvVars: true,
			validate: (env) => env,
		});
		const context = app([ConfigModule]);
		await context.init();
		expect(
			context.scope
				.resolve<RootConfigService<{ PORT: string }>>("rootConfig")
				.get("PORT"),
		).toBe("3000");
		await context.close();
		const InvalidModule = createConfigModuleFactory({
			envFilePath: join(file, ".."),
			validate: (env) => env,
		});
		await expect(app([InvalidModule]).init()).rejects.toThrow();
	});

	it("validates and converts synchronously on first resolution", async () => {
		const ConfigModule = createConfigModuleFactory({
			envFilePath: envFile("PORT=3000"),
			ignoreEnvVars: true,
			validate: (env) => ({ port: Number(env.PORT) }),
		});
		const context = app([ConfigModule({ keys: ["port"] })]);
		expect(
			context.scope
				.resolve<ConfigService<{ port: number }>>("config")
				.get("port"),
		).toBe(3000);
		await context.close();
	});

	it("throws synchronously on validation failure during resolution", () => {
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate: () => {
				throw new Error("Invalid PORT");
			},
		});
		const context = app([ConfigModule]);
		expect(() => context.scope.resolve("rootConfig")).toThrow("Invalid PORT");
	});

	it("creates independent config instances per context", async () => {
		const validate = vi.fn(() => ({ count: 1 }));
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate,
		});
		const first = app([ConfigModule]);
		const second = app([ConfigModule]);
		await first.init();
		await second.init();
		expect(first.scope.resolve("rootConfig")).not.toBe(
			second.scope.resolve("rootConfig"),
		);
		expect(validate).toHaveBeenCalledTimes(2);
		await first.close();
		await second.close();
	});

	it("supports optional values and freezes top-level configuration", async () => {
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate: (): { optional?: string; port: number } => ({ port: 3000 }),
		});
		const context = app([ConfigModule, ConfigModule({ keys: ["optional"] })]);
		await context.init();
		const root =
			context.scope.resolve<
				RootConfigService<{ optional?: string; port: number }>
			>("rootConfig");
		expect(root.get("optional")).toBeUndefined();
		expect(Object.isFrozen(root.get())).toBe(true);
		expect(
			context.scope
				.resolve<ConfigService<{ optional?: string }>>("config")
				.get(),
		).toEqual({ optional: undefined });
		await context.close();
	});

	it("supports exact custom provider names for multiple configurations", async () => {
		const First = createConfigModuleFactory({
			rootProviderName: "firstRoot",
			scopedProviderName: "firstConfig",
			ignoreEnvFile: true,
			validate: () => ({ port: 1 }),
		});
		const Second = createConfigModuleFactory({
			rootProviderName: "secondRoot",
			scopedProviderName: "secondConfig",
			ignoreEnvFile: true,
			validate: () => ({ port: 2 }),
		});
		const context = app([
			First,
			Second,
			First({ keys: ["port"] }),
			Second({ keys: ["port"] }),
		]);
		await context.init();
		expect(
			context.scope
				.resolve<ConfigService<{ port: number }>>("firstConfig")
				.get("port"),
		).toBe(1);
		expect(
			context.scope
				.resolve<ConfigService<{ port: number }>>("secondConfig")
				.get("port"),
		).toBe(2);
		expect(context.scope.hasRegistration("rootConfig")).toBe(false);
		await context.close();
	});

	it("rejects invalid provider names", () => {
		const options = { validate: () => ({ port: 1 }) };
		expect(() =>
			createConfigModuleFactory({
				...options,
				rootProviderName: "same",
				scopedProviderName: "same",
			}),
		).toThrow("distinct");
		expect(() =>
			// @ts-expect-error Empty provider names must also fail at runtime.
			createConfigModuleFactory({ ...options, rootProviderName: "" }),
		).toThrow("non-empty");
	});
});

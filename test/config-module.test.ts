import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModule, DIContext, type ModuleDef } from "awilixify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ConfigService,
	createConfigModuleFactory,
	type Environment,
	type RootConfigService,
	type RootConfigServiceOptions,
} from "../index.js";

let directory: string;
let originalCwd: string;
let nextFile: number;

beforeEach(() => {
	originalCwd = process.cwd();
	directory = mkdtempSync(join(tmpdir(), "awilixify-config-"));
	nextFile = 0;
	// Resolve the default .env inside this test's temporary directory, not the repo.
	process.chdir(directory);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	process.chdir(originalCwd);
	rmSync(directory, { recursive: true });
});

function envFile(contents: string, name = `.env.${nextFile++}`): string {
	const path = join(directory, name);
	writeFileSync(path, contents);
	return path;
}

function setup<
	Config extends object = Environment,
	const Key extends Extract<keyof Config, string> = never,
>(
	options: RootConfigServiceOptions<Config> = {} as RootConfigServiceOptions<Config>,
	keys: readonly Key[] = [],
) {
	const ConfigModule = createConfigModuleFactory<Config>({
		ignoreEnvVars: true,
		...options,
	});
	const context = DIContext.create({
		name: "App",
		imports: [ConfigModule, ConfigModule({ keys })],
	});
	return {
		context,
		rootConfig: context.scope.resolve<RootConfigService<Config>>("rootConfig"),
		config: context.scope.resolve<ConfigService<Pick<Config, Key>>>("config"),
	};
}

describe("ConfigModuleFactory", () => {
	it("loads the default .env without validation and keeps raw string values", () => {
		envFile("PORT=3000", ".env");
		const { rootConfig } = setup();

		expect(rootConfig.get("PORT")).toBe("3000");
		expect(Object.isFrozen(rootConfig.get())).toBe(true);
	});

	it("validates the default .env synchronously on resolution", () => {
		envFile("PORT=3000", ".env");
		const validate = vi.fn((env: Record<string, string | undefined>) => ({
			port: Number(env.PORT),
		}));

		const { rootConfig } = setup({ validate });

		expect(validate).toHaveBeenCalledExactlyOnceWith({ PORT: "3000" });
		expect(rootConfig.get()).toEqual({ port: 3000 });
		expect(rootConfig.get("port")).toBe(3000);
		expect(validate).toHaveBeenCalledTimes(1);
	});

	it("does not load the default file when the path list is empty", () => {
		envFile("PORT=3000", ".env");
		const { rootConfig } = setup({ envFilePath: [] });

		expect(rootConfig.get()).toEqual({});
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"throws EACCES when permission to read an env file is denied",
		() => {
			const path = envFile("PORT=3000");
			chmodSync(path, 0o000);

			try {
				const ConfigModule = createConfigModuleFactory({ envFilePath: path });
				const context = DIContext.create({
					name: "App",
					imports: [ConfigModule],
				});
				expect(() => context.scope.resolve("rootConfig")).toThrowError(
					expect.objectContaining({ code: "EACCES" }),
				);
			} finally {
				chmodSync(path, 0o600);
			}
		},
	);

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
		const context = DIContext.create({
			name: "App",
			imports: [
				ConfigModule,
				createModule<WebDef>({ name: "Web", imports: [webConfig] }),
				ConfigModule({ keys: ["port"] }),
			],
		});

		const root = context.scope.resolve<any>("rootConfig");
		const web = context.importedScopes.get("Web");
		const config = web?.scope.resolve<any>("config");

		await context.init();

		expect(root.get()).toEqual({
			host: "localhost",
			port: 3000,
			secret: "private",
		});
		expect(config?.get()).toEqual({ host: "localhost", port: 3000 });
		expect(() => config?.get("secret")).toThrow(
			'Configuration key "secret" is not allowed in this scope',
		);
		expect(context.scope.resolve<any>("config").get()).toEqual({ port: 3000 });
		expect(validate).toHaveBeenCalledTimes(1);
	});

	it("initializes through a child import alone and allows an empty key selection", async () => {
		const ConfigModule = createConfigModuleFactory({
			ignoreEnvFile: true,
			validate: () => ({ port: 3000 }),
		});
		const context = DIContext.create({
			name: "App",
			imports: [ConfigModule({ keys: [] })],
		});
		await context.init();
		expect(
			context.scope.resolve<ConfigService<object>>("config").get(),
		).toEqual({});
		expect(context.scope.hasRegistration("rootConfig")).toBe(false);
		const config = context.scope.resolve<ConfigService<object>>("config");
		expect(() => {
			// @ts-expect-error Empty scopes must also reject access at runtime.
			config.get("port");
		}).toThrow('Configuration key "port" is not allowed in this scope');
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
		const { context, rootConfig } = setup({
			envFilePath: [first, second],
			ignoreEnvVars: false,
		});

		await context.init();

		expect(rootConfig.get()).toMatchObject({
			AWILIXIFY_CONFIG_TEST_OVERRIDE: "environment",
			AWILIXIFY_CONFIG_TEST_FILE_ONLY: "first",
			SECOND_ONLY: "yes",
			QUOTED: "hello # world",
			MULTILINE: "line1\nline2",
		});
		expect(process.env.AWILIXIFY_CONFIG_TEST_FILE_ONLY).toBeUndefined();
	});

	it("skips file loading when requested", async () => {
		const { rootConfig } = setup({
			envFilePath: envFile("PORT=3000"),
			ignoreEnvFile: true,
		});

		expect(rootConfig.get()).toEqual({});
	});

	it("throws synchronously on validation failure during resolution", () => {
		const ConfigModule = createConfigModuleFactory({
			validate: () => {
				throw new Error("Invalid PORT");
			},
		});

		const context = DIContext.create({ name: "App", imports: [ConfigModule] });
		expect(() => context.scope.resolve("rootConfig")).toThrow("Invalid PORT");
	});

	it("supports optional values", async () => {
		const { rootConfig, config } = setup(
			{
				validate: (): { optional?: string; port: number } => ({ port: 3000 }),
			},
			["optional"],
		);

		expect(rootConfig.get("optional")).toBeUndefined();
		expect(config.get("optional")).toBeUndefined();
		expect(config.get()).toEqual({ optional: undefined });
	});

	it("keeps configurations separate with custom provider names", () => {
		const First = createConfigModuleFactory({
			rootProviderName: "firstRoot",
			scopedProviderName: "firstConfig",
			validate: () => ({ port: 1 }),
		});
		const Second = createConfigModuleFactory({
			rootProviderName: "secondRoot",
			scopedProviderName: "secondConfig",
			validate: () => ({ port: 2 }),
		});
		const context = DIContext.create({
			name: "App",
			imports: [First({ keys: ["port"] }), Second({ keys: ["port"] })],
		});

		expect(context.scope.resolve<any>("firstConfig").get("port")).toBe(1);
		expect(context.scope.resolve<any>("secondConfig").get("port")).toBe(2);
	});

	it("rejects invalid provider names", () => {
		expect(() =>
			createConfigModuleFactory({
				rootProviderName: "same",
				scopedProviderName: "same",
			}),
		).toThrow("distinct");

		expect(() =>
			// @ts-expect-error Empty provider names must also fail at runtime.
			createConfigModuleFactory({ rootProviderName: "" }),
		).toThrow("non-empty");
	});
});

import type { ModuleDef } from "awilixify";
import { describe, expect, test } from "tstyche";
import {
	type ConfigService,
	createConfigModuleFactory,
	type Environment,
	type RootConfigService,
} from "../index.js";

const ConfigModule = createConfigModuleFactory({
	validate: (env) => {
		expect(env).type.toBe<Environment>();
		return { host: "localhost", port: Number(env.PORT), secret: "private" };
	},
});
const WebConfig = ConfigModule({ keys: ["host", "port"] });
type RootDef = ModuleDef<{ imports: [typeof ConfigModule] }>;
type WebDef = ModuleDef<{ imports: [typeof WebConfig] }>;
declare const root: RootDef["deps"]["rootConfig"];
declare const config: WebDef["deps"]["config"];
declare const wideName: string;
declare const unionName: "first" | "second";
declare const patternName: `config_${number}`;

describe("configuration types", () => {
	test("infers root and scoped service types from validate", () => {
		expect(root).type.toBe<
			RootConfigService<{ host: string; port: number; secret: string }>
		>();
		expect(root.get("secret")).type.toBe<string>();
		expect(config).type.toBe<ConfigService<{ host: string; port: number }>>();
		expect(config.get("port")).type.toBe<number>();
		expect(config.get("host")).type.toBe<string>();
		expect(config.get()).type.toBe<Readonly<{ host: string; port: number }>>();
		expect(config.get).type.not.toBeCallableWith("secret");
		expect(config.get).type.not.toBeCallableWith("missing");
		// @ts-expect-error is not assignable
		ConfigModule({ keys: ["missing"] });
		expect<Extract<keyof WebDef["deps"], string>>().type.toBe<"config">();
		// @ts-expect-error read-only property
		config.get().port = 4000;
	});

	test("infers empty and optional configurations", () => {
		const Empty = ConfigModule({ keys: [] });
		type EmptyDef = ModuleDef<{ imports: [typeof Empty] }>;
		const empty = {} as EmptyDef["deps"]["config"];
		expect(empty.get()).type.toBe<Readonly<Record<never, never>>>();
		expect(empty.get).type.not.toBeCallableWith("port");

		const Optional = createConfigModuleFactory({
			validate: (): { port: number; token?: string } => ({
				port: 3000,
			}),
		});
		const Token = Optional({ keys: ["token"] });
		type TokenDef = ModuleDef<{ imports: [typeof Token] }>;
		const token = {} as TokenDef["deps"]["config"];
		expect(token.get("token")).type.toBe<string | undefined>();
		expect(token.get()).type.toBe<Readonly<{ token?: string }>>();
	});

	test("preserves exact custom provider names", () => {
		const Named = createConfigModuleFactory({
			rootProviderName: "settings",
			scopedProviderName: "webSettings",
			validate: () => ({ port: 3000 }),
		});
		const Scoped = Named({ keys: ["port"] });
		type NamedDef = ModuleDef<{ imports: [typeof Named, typeof Scoped] }>;
		expect<NamedDef["deps"]["settings"]>().type.toBe<
			RootConfigService<{ port: number }>
		>();
		expect<NamedDef["deps"]["webSettings"]>().type.toBe<
			ConfigService<{ port: number }>
		>();
		expect<Extract<keyof NamedDef["deps"], string>>().type.toBe<
			"settings" | "webSettings"
		>();
	});

	test("defaults to raw environment types without validation", () => {
		const Raw = createConfigModuleFactory({});
		const Scoped = Raw({ keys: ["PORT"] });
		type RawDef = ModuleDef<{ imports: [typeof Raw, typeof Scoped] }>;
		expect<RawDef["deps"]["rootConfig"]>().type.toBe<
			RootConfigService<Environment>
		>();
		const config = {} as RawDef["deps"]["config"];
		expect(config.get("PORT")).type.toBe<string | undefined>();
		expect(config.get).type.not.toBeCallableWith("HOST");
	});

	test("requires validation to return an object", () => {
		// @ts-expect-error is not assignable
		createConfigModuleFactory({ validate: () => "invalid" });
		// @ts-expect-error is not assignable
		createConfigModuleFactory<{ port: number }>({});
		const asyncOptions = { validate: async () => ({ port: 3000 }) };
		// @ts-expect-error is not assignable
		createConfigModuleFactory(asyncOptions);
	});

	test("rejects ambiguous and mismatched provider names", () => {
		const wide = { validate: () => ({}), rootProviderName: wideName };
		const union = { validate: () => ({}), scopedProviderName: unionName };
		const pattern = { validate: () => ({}), rootProviderName: patternName };
		// @ts-expect-error is not assignable
		createConfigModuleFactory(wide);
		// @ts-expect-error is not assignable
		createConfigModuleFactory(union);
		// @ts-expect-error is not assignable
		createConfigModuleFactory(pattern);
		// @ts-expect-error is not assignable
		createConfigModuleFactory<{ port: number }, "settings">({
			validate: () => ({ port: 3000 }),
		});
	});
});

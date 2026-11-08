import type { ModuleDef } from "awilixify";
import { describe, expect, test } from "tstyche";
import {
	type ConfigService,
	createConfigModuleFactory,
	type Environment,
	type RootConfigService,
} from "../index.js";

function createFixture() {
	const ConfigModule = createConfigModuleFactory({
		validate: (env) => {
			expect(env).type.toBe<Environment>();

			return { host: "localhost", port: Number(env.PORT), secret: "private" };
		},
	});
	const WebConfig = ConfigModule({ keys: ["host", "port"] });

	return { ConfigModule, WebConfig };
}

const fixture = createFixture();
type ConsumerDef = ModuleDef<{
	imports: [typeof fixture.ConfigModule, typeof fixture.WebConfig];
}>;

declare const root: ConsumerDef["deps"]["rootConfig"];
declare const config: ConsumerDef["deps"]["config"];
declare const wideName: string;
declare const unionName: "first" | "second";
declare const patternName: `config_${number}`;

describe("configuration types", () => {
	test("infers root and scoped service types through consumer modules", () => {
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
		expect(fixture.ConfigModule).type.not.toBeCallableWith({
			keys: ["missing"],
		});
	});

	test("infers empty configurations", () => {
		const Empty = fixture.ConfigModule({ keys: [] });
		type Def = ModuleDef<{ imports: [typeof Empty] }>;
		expect<Def["deps"]["config"]>().type.toBe<
			ConfigService<Record<never, never>>
		>();
		expect<Def["deps"]["config"]["get"]>().type.not.toBeCallableWith("port");
	});

	test("infers optional configurations", () => {
		const Optional = createConfigModuleFactory({
			validate: (): { port: number; token?: string } => ({ port: 3000 }),
		});
		const Token = Optional({ keys: ["token"] });
		type Def = ModuleDef<{ imports: [typeof Token] }>;
		expect<Def["deps"]["config"]>().type.toBe<
			ConfigService<{ token?: string }>
		>();
		expect<ReturnType<Def["deps"]["config"]["get"]>>().type.toBe<
			string | undefined
		>();
	});

	test("preserves exact custom provider names", () => {
		const Named = createConfigModuleFactory({
			rootProviderName: "settings",
			scopedProviderName: "webSettings",
			validate: () => ({ port: 3000 }),
		});
		const Scoped = Named({ keys: ["port"] });
		type Def = ModuleDef<{ imports: [typeof Named, typeof Scoped] }>;

		expect<Def["deps"]["settings"]>().type.toBe<
			RootConfigService<{ port: number }>
		>();
		expect<Def["deps"]["webSettings"]>().type.toBe<
			ConfigService<{ port: number }>
		>();
	});

	test("defaults to raw environment types without validation", () => {
		const Raw = createConfigModuleFactory({});
		const Scoped = Raw({ keys: ["PORT"] });

		type Def = ModuleDef<{ imports: [typeof Raw, typeof Scoped] }>;

		expect<Def["deps"]["rootConfig"]>().type.toBe<
			RootConfigService<Environment>
		>();
		expect<Def["deps"]["config"]>().type.toBe<
			ConfigService<{ PORT: string | undefined }>
		>();
	});

	test("requires validation to return an object", () => {
		expect(createConfigModuleFactory).type.not.toBeCallableWith({
			validate: () => "invalid",
		});
		expect(
			createConfigModuleFactory<{ port: number }>,
		).type.not.toBeCallableWith({});
		expect(createConfigModuleFactory).type.not.toBeCallableWith({
			validate: async () => ({ port: 3000 }),
		});
	});

	test("rejects ambiguous and mismatched provider names", () => {
		const wide = { validate: () => ({}), rootProviderName: wideName };
		const union = { validate: () => ({}), scopedProviderName: unionName };
		const pattern = { validate: () => ({}), rootProviderName: patternName };
		expect(createConfigModuleFactory).type.not.toBeCallableWith(wide);
		expect(createConfigModuleFactory).type.not.toBeCallableWith(union);
		expect(createConfigModuleFactory).type.not.toBeCallableWith(pattern);
		expect(
			createConfigModuleFactory<{ port: number }, "settings">,
		).type.not.toBeCallableWith({
			validate: () => ({ port: 3000 }),
		});
	});
});

import type { AnyModule, Module } from "awilixify";
import { ConfigService } from "./config.service.js";
import {
	type Environment,
	RootConfigService,
	type RootConfigServiceOptions,
} from "./root-config.service.js";
import type { LiteralName } from "./types.js";

const DEFAULT_PROVIDER_NAMES = {
	rootProviderName: "rootConfig",
	scopedProviderName: "config",
} as const;

type ProviderNameOption<
	Key extends keyof typeof DEFAULT_PROVIDER_NAMES,
	Name extends string,
> = {
	[Property in Key]?: Name & LiteralName<Name>;
} & ([Name] extends [(typeof DEFAULT_PROVIDER_NAMES)[Key]]
	? unknown
	: Record<Key, Name>);

type NamedProvider<Name extends string, Value> = {
	providers: Record<Name, Value>;
	exports: Record<Name, Value>;
	exportKeys: [Name];
};

type RootDef<Config extends object, Name extends string> = NamedProvider<
	Name,
	RootConfigService<Config>
>;

type ScopeDef<
	Config extends object,
	Key extends keyof Config,
	RootName extends string,
	ScopedName extends string,
> = NamedProvider<ScopedName, ConfigService<Pick<Config, Key>>> & {
	imports: [Module<RootDef<Config, RootName>>];
};

type ConfigModuleFactory<
	Config extends object,
	RootName extends string,
	ScopedName extends string,
> = Module<RootDef<Config, RootName>> &
	(<const Key extends Extract<keyof Config, string>>(scope: {
		keys: readonly Key[];
	}) => Module<ScopeDef<Config, Key, RootName, ScopedName>>);

let nextId = 0;

export function createConfigModuleFactory<
	Config extends object = Environment,
	const RootName extends string = "rootConfig",
	const ScopedName extends string = "config",
>(
	options: RootConfigServiceOptions<Config> &
		ProviderNameOption<"rootProviderName", RootName> &
		ProviderNameOption<"scopedProviderName", ScopedName>,
): ConfigModuleFactory<Config, RootName, ScopedName> {
	const {
		rootProviderName = DEFAULT_PROVIDER_NAMES.rootProviderName,
		scopedProviderName = DEFAULT_PROVIDER_NAMES.scopedProviderName,
	} = options;

	if (
		typeof rootProviderName !== "string" ||
		typeof scopedProviderName !== "string" ||
		!rootProviderName ||
		!scopedProviderName ||
		rootProviderName === scopedProviderName
	) {
		throw new Error(
			"Root and scoped provider names must be non-empty, distinct strings",
		);
	}

	const root: AnyModule = {
		name: `ConfigRootModule_${++nextId}`,
		providers: {
			[rootProviderName]: {
				useFactory: () => new RootConfigService<Config>(options),
				lifetime: "SINGLETON",
				eager: true,
			},
		},
		exports: [rootProviderName],
	};

	const createScope = (scope: {
		keys: readonly Extract<keyof Config, string>[];
	}): AnyModule => {
		const keys = [...scope.keys];

		return {
			name: `ConfigScopeModule_${++nextId}`,
			imports: [factory],
			providers: {
				[scopedProviderName]: {
					useFactory: (rootConfig: RootConfigService<Config>) =>
						new ConfigService(rootConfig, keys),
					inject: [rootProviderName],
					lifetime: "SINGLETON",
					eager: true,
				},
			},
			exports: [scopedProviderName],
		};
	};

	const { name, ...definition } = root;
	const factory = Object.assign(createScope, definition);
	// Function names are not writable; keep the module name enumerable for spreads.
	Object.defineProperty(factory, "name", { value: name, enumerable: true });

	// Computed provider keys widen to string; restore their exact inferred names.
	return factory as unknown as ConfigModuleFactory<
		Config,
		RootName,
		ScopedName
	>;
}
